import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"
import * as pulumi from "@pulumi/pulumi"
import { configureNetwork } from "./configureNetwork"

const config = new pulumi.Config()
const containerPort = config.getNumber("containerPort") || 3000
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
  lbSg,
  redisSubnetGroup,
  dbSubnetGroup,
  appTargetGroup,
} = configureNetwork({ stack, dbPort })

// Create an RDS instance
const database = new aws.rds.Instance(`buho-docs-postgres-${stack}`, {
  engine: "postgres",
  engineVersion: "16.1",
  instanceClass: "db.t3.micro",
  allocatedStorage: 20,
  dbName: dbName,
  username: dbUser,
  password: dbPassword,
  skipFinalSnapshot: true,
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  dbSubnetGroupName: dbSubnetGroup.name,
})

// Create Redis cluster
const redis = new aws.elasticache.Cluster(`buho-docs-redis-${stack}`, {
  clusterId: "redis-buho-docs",
  engine: "redis",
  nodeType: "cache.t3.micro",
  numCacheNodes: 1,
  port: 6379,
  securityGroupIds: [redisSecurityGroup.id],
  subnetGroupName: redisSubnetGroup.name,
})

// An ECR repository to store our application's container image
const repo = new awsx.ecr.Repository(`buho-docs-${stack}-repo`, {
  forceDelete: true,
})

// Build and publish our application's container image
const image = new awsx.ecr.Image(`buho-docs-${stack}-image`, {
  repositoryUrl: repo.url,
  context: "../",
  platform: "linux/amd64",
})

// An ECS cluster to deploy into
const cluster = new aws.ecs.Cluster(`buho-docs-${stack}-cluster`, {})
// Deploy an ECS Service on Fargate to host the application container
const service = new awsx.ecs.FargateService(`buho-docs-${stack}-service`, {
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
          hostPort: 3000,
          targetGroup: appTargetGroup,
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
          value: "docs.buhochile.com",
        },
        {
          name: "PORT",
          value: "3000",
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
    subnets: vpc.publicSubnetIds,
    assignPublicIp: true,
    securityGroups: [docsAppSg.id, lbSg.id],
  },
})

// Export the necessary connection information
export const url = pulumi.interpolate`http://${lb.loadBalancer.dnsName}`
export const databaseEndpoint = database.endpoint
export const redisEndpoint = pulumi.interpolate`${redis.cacheNodes[0].address}:${redis.port}`
