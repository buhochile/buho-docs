import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"

const config = new pulumi.Config()
const containerPort = config.getNumber("containerPort") || 80
const cpu = config.getNumber("cpu") || 512
const memory = config.getNumber("memory") || 128

// Database configuration
const dbName = "docmost"
const dbUser = "docmost"
const dbPassword = config.requireSecret("dbPassword")
const dbPort = 5432
const appSecret = config.requireSecret("appSecret")

// Create a VPC
const vpc = new awsx.ec2.Vpc("vpc", {
  numberOfAvailabilityZones: 2,
  natGateways: {
    strategy: "None", // Changed from "Single" to "None"
  },
})

// Create a security group for the database
const dbSecurityGroup = new aws.ec2.SecurityGroup("db-securitygroup", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: dbPort,
      toPort: dbPort,
      cidrBlocks: [vpc.vpc.cidrBlock], // Only allow access from within the VPC
    },
  ],
  egress: [
    {
      // Add egress rule
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
})

// Create an RDS instance
const database = new aws.rds.Instance("postgres", {
  engine: "postgres",
  engineVersion: "16.1",
  instanceClass: "db.t3.micro",
  allocatedStorage: 20,
  dbName: dbName,
  username: dbUser,
  password: dbPassword,
  skipFinalSnapshot: true,
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  dbSubnetGroupName: new aws.rds.SubnetGroup("database-subnet-group", {
    subnetIds: vpc.privateSubnetIds,
  }).name,
})

// Create ElastiCache (Redis) security group
const redisSecurityGroup = new aws.ec2.SecurityGroup("redis-securitygroup", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 6379,
      toPort: 6379,
      cidrBlocks: [vpc.vpc.cidrBlock], // Only allow access from within the VPC
    },
  ],
  egress: [
    {
      // Add egress rule
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
})

// Create ElastiCache subnet group
const redisSubnetGroup = new aws.elasticache.SubnetGroup("redis-subnet-group", {
  name: "cache-buho-docs",
  subnetIds: vpc.privateSubnetIds,
})

// Create Redis cluster
const redis = new aws.elasticache.Cluster("redis", {
  clusterId: "redis-buho-docs",
  engine: "redis",
  nodeType: "cache.t3.micro",
  numCacheNodes: 1,
  port: 6379,
  securityGroupIds: [redisSecurityGroup.id],
  subnetGroupName: redisSubnetGroup.name,
})

// An ECS cluster to deploy into
const cluster = new aws.ecs.Cluster("cluster", {})

// Add a security group for the ECS tasks
const ecsSecurityGroup = new aws.ec2.SecurityGroup("ecs-securitygroup", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 3000,
      toPort: 3000,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
})

// An ALB to serve the container endpoint to the internet
const loadbalancer = new awsx.lb.ApplicationLoadBalancer(`loadbalancer`, {
  subnetIds: vpc.publicSubnetIds,
  defaultTargetGroup: {
    vpcId: vpc.vpcId,
    port: 3000,
    healthCheck: {
      path: "/health",
      interval: 30,
      timeout: 15,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
    },
  },
  securityGroups: [ecsSecurityGroup.id],
})

// An ECR repository to store our application's container image
const repo = new awsx.ecr.Repository("repo", {
  forceDelete: true,
})

// Build and publish our application's container image from ./app to the ECR repository
const image = new awsx.ecr.Image("image", {
  repositoryUrl: repo.url,
  context: "../",
  platform: "linux/amd64",
})

// Deploy an ECS Service on Fargate to host the application container
const service = new awsx.ecs.FargateService("service", {
  cluster: cluster.arn,
  taskDefinitionArgs: {
    container: {
      name: "app",
      image: image.imageUri,
      cpu: cpu,
      memory: memory,
      essential: true,
      portMappings: [
        {
          containerPort: 3000,
          targetGroup: loadbalancer.defaultTargetGroup,
        },
      ],
      environment: [
        {
          name: "DATABASE_URL",
          value: pulumi.interpolate`postgresql://${dbUser}:${dbPassword}@${database.endpoint}/${dbName}`,
        },
        {
          name: "REDIS_URL",
          value: pulumi.interpolate`redis://${redis.cacheNodes[0].address}:${redis.port}`,
        },
        {
          name: "APP_SECRET",
          value: appSecret,
        },
        // Add new environment variables
        {
          name: "APP_URL",
          value: pulumi.interpolate`http://${loadbalancer.loadBalancer.dnsName}`,
        },
        {
          name: "PORT",
          value: containerPort.toString(),
        },
        {
          name: "JWT_TOKEN_EXPIRES_IN",
          value: "30d",
        },
        {
          name: "STORAGE_DRIVER",
          value: "local", // or "s3" based on your needs
        },
        {
          name: "FILE_UPLOAD_SIZE_LIMIT",
          value: "50mb",
        },
        {
          name: "MAIL_DRIVER",
          value: "smtp",
        },
        {
          name: "MAIL_FROM_ADDRESS",
          value: "hello@example.com", // Configure as needed
        },
        {
          name: "MAIL_FROM_NAME",
          value: "Docmost",
        },
      ],
    },
  },
  networkConfiguration: {
    subnets: vpc.privateSubnetIds,
    assignPublicIp: true,
    securityGroups: [ecsSecurityGroup.id],
  },
})

// Export the necessary connection information
export const url = pulumi.interpolate`http://${loadbalancer.loadBalancer.dnsName}`
export const databaseEndpoint = database.endpoint
export const redisEndpoint = pulumi.interpolate`${redis.cacheNodes[0].address}:${redis.port}`
