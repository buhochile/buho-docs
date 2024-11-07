import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"
import * as pulumi from "@pulumi/pulumi"
import { configureNetwork } from "./configureNetwork"
import { configureS3 } from "./configureS3"

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

const googleSMTPPassword = config.requireSecret("googleSMTPPassword")

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

const { s3Bucket, s3AccessKeyId, s3SecretAccessKey, s3Endpoint } = configureS3({
  stack,
})

const dbParameterGroupName = new aws.rds.ParameterGroup(
  `buho-docs-postgres-${stack}-parameter-group`,
  {
    family: "postgres16",
    parameters: [
      { name: "log_statement", value: "all" },
      { name: "rds.force_ssl", value: "0" },
    ],
  },
)

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
  parameterGroupName: dbParameterGroupName.name,
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
          value: "s3",
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
          name: "SMTP_HOST",
          value: "smtp.gmail.com",
        },
        {
          name: "SMTP_PORT",
          value: "587",
        },
        {
          name: "SMTP_USERNAME",
          value: "dan@buhochile.com",
        },
        {
          name: "SMTP_PASSWORD",
          value: googleSMTPPassword,
        },
        {
          name: "SMTP_SECURE",
          value: "465",
        },
        {
          name: "MAIL_FROM_ADDRESS",
          value: "developers@buhochile.com",
        },
        {
          name: "MAIL_FROM_NAME",
          value: "Buho Docs",
        },
        {
          name: "AWS_S3_ACCESS_KEY_ID",
          value: s3AccessKeyId,
        },
        {
          name: "AWS_S3_SECRET_ACCESS_KEY",
          value: s3SecretAccessKey,
        },
        {
          name: "AWS_S3_REGION",
          value: aws.getRegion().then((region) => region.name),
        },
        {
          name: "AWS_S3_BUCKET",
          value: s3Bucket.id,
        },
        {
          name: "AWS_S3_ENDPOINT",
          value: s3Endpoint,
        },
        {
          name: "AWS_S3_FORCE_PATH_STYLE",
          value: "false",
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
