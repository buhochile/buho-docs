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

// Create a security group for the database
const dbSecurityGroup = new aws.ec2.SecurityGroup("db-securitygroup", {
  ingress: [
    {
      protocol: "tcp",
      fromPort: dbPort,
      toPort: dbPort,
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
})

// Create ElastiCache (Redis) security group
const redisSecurityGroup = new aws.ec2.SecurityGroup("redis-securitygroup", {
  ingress: [
    {
      protocol: "tcp",
      fromPort: 6379,
      toPort: 6379,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
})

// Create ElastiCache subnet group
const redisSubnetGroup = new aws.elasticache.SubnetGroup("redis-subnet-group", {
  subnetIds: [
    /* You'll need to specify your subnet IDs here */
  ],
})

// Create Redis cluster
const redis = new aws.elasticache.Cluster("redis", {
  engine: "redis",
  engineVersion: "7.2",
  nodeType: "cache.t3.micro",
  numCacheNodes: 1,
  port: 6379,
  securityGroupIds: [redisSecurityGroup.id],
  subnetGroupName: redisSubnetGroup.name,
})

// An ECS cluster to deploy into
const cluster = new aws.ecs.Cluster("cluster", {})

// An ALB to serve the container endpoint to the internet
const loadbalancer = new awsx.lb.ApplicationLoadBalancer("loadbalancer", {})

// An ECR repository to store our application's container image
const repo = new awsx.ecr.Repository("repo", {
  forceDelete: true,
})

// Build and publish our application's container image from ./app to the ECR repository
const image = new awsx.ecr.Image("image", {
  repositoryUrl: repo.url,
  context: "../..",
  platform: "linux/amd64",
})

// Deploy an ECS Service on Fargate to host the application container
const service = new awsx.ecs.FargateService("service", {
  cluster: cluster.arn,
  assignPublicIp: true,
  taskDefinitionArgs: {
    container: {
      name: "app",
      image: image.imageUri,
      cpu: cpu,
      memory: memory,
      essential: true,
      portMappings: [
        {
          containerPort: containerPort,
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
      ],
    },
  },
})

// Export the necessary connection information
export const url = pulumi.interpolate`http://${loadbalancer.loadBalancer.dnsName}`
export const databaseEndpoint = database.endpoint
export const redisEndpoint = pulumi.interpolate`${redis.cacheNodes[0].address}:${redis.port}`
