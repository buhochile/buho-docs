import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"

interface S3ConfigurationResult {
  s3Bucket: aws.s3.Bucket
  s3AccessKeyId: pulumi.Output<string>
  s3SecretAccessKey: pulumi.Output<string>
  s3Endpoint: pulumi.Output<string>
}

export function configureS3({
  stack,
}: {
  stack: string
}): S3ConfigurationResult {
  // Create S3 bucket
  const s3Bucket = new aws.s3.Bucket(`buho-docs-${stack}-s3`, {
    bucket: `buho-docs-${stack}-s3`,
  })

  // Create IAM user for S3 access
  const s3User = new aws.iam.User(`buho-docs-${stack}-s3-user`, {
    name: `buho-docs-${stack}-s3-user`,
  })

  // Create access keys for the IAM user
  const s3UserAccessKey = new aws.iam.AccessKey(
    `buho-docs-${stack}-s3-access-key`,
    {
      user: s3User.name,
    },
  )

  // Create IAM policy for S3 access
  const s3Policy = new aws.iam.Policy(`buho-docs-${stack}-s3-policy`, {
    policy: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:DeleteObject",
            "s3:ListBucket",
          ],
          Resource: [s3Bucket.arn, pulumi.interpolate`${s3Bucket.arn}/*`],
        },
      ],
    },
  })

  // Attach the policy to the user
  const s3UserPolicyAttachment = new aws.iam.UserPolicyAttachment(
    `buho-docs-${stack}-s3-user-policy`,
    {
      user: s3User.name,
      policyArn: s3Policy.arn,
    },
  )

  const region = aws.getRegion().then((region) => region.name)
  const endpoint = pulumi.interpolate`https://s3.${region}.amazonaws.com`

  return {
    s3Bucket,
    s3AccessKeyId: s3UserAccessKey.id,
    s3SecretAccessKey: s3UserAccessKey.secret,
    s3Endpoint: pulumi.interpolate`https://s3.${aws.getRegion().then((region) => region.name)}.amazonaws.com`,
  }
}
