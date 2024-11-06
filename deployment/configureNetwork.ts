import * as aws from "@pulumi/aws"
import * as awsx from "@pulumi/awsx"
import * as pulumi from "@pulumi/pulumi"

interface Props {
  stack: string
  dbPort: number
}

export function configureNetwork({ stack, dbPort }: Props) {
  const vpc = new awsx.ec2.Vpc(`buho-docs-vpc-${stack}`, {
    cidrBlock: "20.0.0.0/16",
    natGateways: {
      strategy: awsx.ec2.NatGatewayStrategy.Single,
    },
  })

  const dbSecurityGroup = new aws.ec2.SecurityGroup(
    "buho-docs-db-securitygroup",
    {
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
    },
  )

  const dbSubnetGroup = new aws.rds.SubnetGroup("buho-docs-db-subnet-group", {
    subnetIds: vpc.privateSubnetIds,
  })

  const redisSecurityGroup = new aws.ec2.SecurityGroup(
    "buho-docs-redis-security-group",
    {
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
    },
  )

  const redisSubnetGroup = new aws.elasticache.SubnetGroup(
    "buho-docs-redis-subnet-group",
    {
      name: "cache-buho-docs",
      subnetIds: vpc.privateSubnetIds,
    },
  )

  const docsAppSg = new aws.ec2.SecurityGroup(`buho-docs-app-sg`, {
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
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
  })

  const lbSg = new aws.ec2.SecurityGroup(`buho-docs-lb-sg`, {
    vpcId: vpc.vpcId,
    ingress: [
      { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
    egress: [
      { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
    ],
  })

  const CERTIFICATE_NAME = "buho-docs-lb-cert"

  const lbCert = new aws.acm.Certificate(CERTIFICATE_NAME, {
    domainName: "docs.buhochile.com",
    validationMethod: "DNS",
  })

  const zone = aws.route53.getZone({
    name: "buhochile.com",
    privateZone: false,
  })

  const appTargetGroup = new aws.lb.TargetGroup(`buho-docs-app-tg`, {
    port: 3000,
    protocol: "HTTP",
    targetType: "ip",
    vpcId: vpc.vpcId,
    healthCheck: {
      path: "/api/health",
      interval: 30,
      timeout: 15,
      healthyThreshold: 2,
      unhealthyThreshold: 2,
    },
  })

  const lb = new awsx.lb.ApplicationLoadBalancer(`buho-docs-lb`, {
    subnetIds: vpc.publicSubnetIds,

    listeners: [
      {
        port: 80,
        protocol: "HTTP",
        defaultActions: [
          {
            type: "redirect",
            redirect: {
              port: "443",
              protocol: "HTTPS",
              statusCode: "HTTP_301",
            },
          },
        ],
      },
      {
        port: 443,
        protocol: "HTTPS",
        certificateArn: lbCert.arn,
        defaultActions: [
          {
            type: "forward",
            targetGroupArn: appTargetGroup.arn,
          },
        ],
      },
    ],
    securityGroups: [lbSg.id],
  })

  const aRecord = new aws.route53.Record("buho-docs-lb-a-record", {
    zoneId: zone.then((dns) => dns.zoneId),
    name: "docs",
    type: aws.route53.RecordType.A,
    aliases: [
      {
        name: lb.loadBalancer.dnsName,
        zoneId: lb.loadBalancer.zoneId,
        evaluateTargetHealth: true,
      },
    ],
  })

  return {
    vpc,
    dbSecurityGroup,
    dbSubnetGroup,
    redisSecurityGroup,
    redisSubnetGroup,
    docsAppSg,
    lb,
    lbSg,
    appTargetGroup,
  }
}
