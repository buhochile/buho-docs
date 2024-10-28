import * as pulumi from "@pulumi/pulumi"
import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"

interface Props {
  stack: string
  dbPort: number
}

export function configureNetwork({ stack, dbPort }: Props) {
  const vpc = new awsx.ec2.Vpc(`vpc-${stack}`, {
    cidrBlock: "10.0.0.0/16",
    numberOfAvailabilityZones: 2,
    enableDnsHostnames: true,
  })

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

  const redisSubnetGroup = new aws.elasticache.SubnetGroup(
    "redis-subnet-group",
    {
      name: "cache-buho-docs",
      subnetIds: vpc.privateSubnetIds,
    },
  )

  const docsAppSg = new aws.ec2.SecurityGroup(`docs-app-${stack}`, {
    vpcId: vpc.vpcId,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 3000,
        toPort: 3000,
        cidrBlocks: ["0.0.0.0/0"],
      },
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
  })

  const lb = new awsx.lb.ApplicationLoadBalancer(`lb-${stack}`, {
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
    securityGroups: [docsAppSg.id],
  })

  return {
    vpc,
    dbSecurityGroup,
    redisSecurityGroup,
    docsAppSg,
    lb,
    redisSubnetGroup,
  }
}
