import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"
import { configureNetwork } from "./configureNetwork"

const config = new pulumi.Config()
const containerPort = config.getNumber("containerPort") || 80
const cpu = config.getNumber("cpu") || 512
const memory = config.getNumber("memory") || 128

const stack = pulumi.getStack()

// Database configuration

const dbName = "docmost"
const dbUser = "docmost"
const dbPassword = config.requireSecret("dbPassword")
const dbPort = 5432
const appSecret = config.requireSecret("appSecret")

// Configure

const {
  vpc,
  dbSecurityGroup,
  redisSecurityGroup,
  docsAppSg,
  lb,
  redisSubnetGroup,
} = configureNetwork({ stack, dbPort })

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

// An ECR repository to store our application's container image
const repo = new awsx.ecr.Repository("repo", {
  forceDelete: true,
})

// Build and publish our application's container image 
const image = new awsx.ecr.Image("image", {
  repositoryUrl: repo.url,
  context: "../",
  platform: "linux/amd64",
})

// Deploy an ECS Service on Fargate to host the application container
const service = new awsx.ecs.FargateService("docs-app-service", {
  cluster: cluster.arn,
  taskDefinitionArgs: {
    container: {
      name: `docs-app-${stack}`,
      image: image.imageUri,
      cpu: cpu,
      memory: memory,
      essential: true,
      portMappings: [
        {
          containerPort: 3000,
          targetGroup: lb.defaultTargetGroup,
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
          value: pulumi.interpolate`http://${lb.loadBalancer.dnsName}`,
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
    assignPublicIp: false,
    securityGroups: [docsAppSg.id],
  },
})



// Export the necessary connection information
export const url = pulumi.interpolate`http://${lb.loadBalancer.dnsName}`
export const databaseEndpoint = database.endpoint
export const redisEndpoint = pulumi.interpolate`${redis.cacheNodes[0].address}:${redis.port}`
