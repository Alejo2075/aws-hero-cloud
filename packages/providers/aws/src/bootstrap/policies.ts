import { BOOTSTRAP_QUALIFIER, BOUNDARY_POLICY_NAME } from '../cdk/names.js';

/** The name of the managed policy CloudFormation uses to create a deployment's resources. */
export const EXECUTION_POLICY_NAME = 'hero-cfn-execution';
/** The stack that holds the two policies, deployed before the CDK bootstrap stack. */
export const PREREQUISITES_STACK = 'hero-prerequisites';
/** The role a person's own identity assumes to run Hero's deployments with limited permissions. */
export const DEPLOYER_ROLE_NAME = 'hero-deployer';
export const DEPLOYER_POLICY_NAME = 'hero-deployer-access';

export interface PolicyStatement {
  readonly Sid: string;
  readonly Effect: 'Allow' | 'Deny';
  readonly Action: readonly string[];
  readonly Resource: string | readonly string[];
  readonly Condition?: Readonly<
    Record<string, Readonly<Record<string, string | readonly string[]>>>
  >;
}

export interface PolicyDocument {
  readonly Version: '2012-10-17';
  readonly Statement: readonly PolicyStatement[];
}

const P = 'arn:${AWS::Partition}';

/** Every resource a deployment creates is named with the `hero-` prefix of its stack. */
const OWN = 'hero-*';

/**
 * The ceiling for every role Hero creates. A role inside a deployment can never do more than this,
 * even if its own policy asks for more: it can write its logs, use this deployment's data and
 * parameters, and nothing about identities, networks, or other accounts.
 */
export function boundaryPolicy(): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'Logs',
        Effect: 'Allow',
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        Resource: `${P}:logs:*:\${AWS::AccountId}:log-group:*`,
      },
      {
        Sid: 'ImagesOfThisDeployment',
        Effect: 'Allow',
        Action: [
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
        ],
        Resource: `${P}:ecr:*:\${AWS::AccountId}:repository/${OWN}`,
      },
      {
        Sid: 'ImageLogin',
        Effect: 'Allow',
        Action: ['ecr:GetAuthorizationToken'],
        Resource: '*',
      },
      {
        Sid: 'OwnLogins',
        Effect: 'Allow',
        Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
        Resource: `${P}:secretsmanager:*:\${AWS::AccountId}:secret:${OWN}`,
      },
      {
        Sid: 'OwnFileSystems',
        Effect: 'Allow',
        Action: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess',
        ],
        Resource: `${P}:elasticfilesystem:*:\${AWS::AccountId}:file-system/*`,
        // Only file systems that carry this deployment's tag, which every Hero stack sets.
        Condition: { StringLike: { 'aws:ResourceTag/hero:deployment-id': 'hero-*' } },
      },
      {
        Sid: 'OwnData',
        Effect: 'Allow',
        Action: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:Scan',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
        ],
        Resource: `${P}:dynamodb:*:\${AWS::AccountId}:table/${OWN}`,
      },
      {
        Sid: 'OwnFiles',
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
          's3:ListBucket',
        ],
        Resource: [`${P}:s3:::${OWN}`, `${P}:s3:::${OWN}/*`],
      },
      {
        Sid: 'OwnParameters',
        Effect: 'Allow',
        Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        Resource: `${P}:ssm:*:\${AWS::AccountId}:parameter/hero/*`,
      },
      {
        Sid: 'DecryptParametersOnly',
        Effect: 'Allow',
        Action: ['kms:Decrypt'],
        Resource: '*',
        Condition: {
          StringLike: {
            'kms:ViaService': ['ssm.*.amazonaws.com', 'secretsmanager.*.amazonaws.com'],
          },
        },
      },
      {
        Sid: 'SchedulerInvokesOwnFunctions',
        Effect: 'Allow',
        Action: ['lambda:InvokeFunction'],
        Resource: `${P}:lambda:*:\${AWS::AccountId}:function:${OWN}`,
      },
    ],
  };
}

/**
 * What CloudFormation may do on the user's behalf while it deploys Hero stacks, in place of the
 * default administrator policy. Resources are limited to the `hero-` prefix wherever the service
 * allows it, roles can only be created under the boundary, and the boundary and this policy can
 * never be changed from inside a deployment.
 */
export function executionPolicy(): PolicyDocument {
  const boundaryArn = `${P}:iam::\${AWS::AccountId}:policy/${BOUNDARY_POLICY_NAME}`;
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'Buckets',
        Effect: 'Allow',
        Action: [
          's3:CreateBucket',
          's3:DeleteBucket',
          's3:Get*',
          's3:List*',
          's3:PutBucket*',
          's3:DeleteBucketPolicy',
          's3:PutEncryptionConfiguration',
          's3:PutLifecycleConfiguration',
          's3:PutAccelerateConfiguration',
        ],
        Resource: `${P}:s3:::${OWN}`,
      },
      {
        Sid: 'CdkAssets',
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:GetBucketLocation'],
        Resource: [
          `${P}:s3:::cdk-${BOOTSTRAP_QUALIFIER}-assets-\${AWS::AccountId}-*`,
          `${P}:s3:::cdk-${BOOTSTRAP_QUALIFIER}-assets-\${AWS::AccountId}-*/*`,
        ],
      },
      {
        Sid: 'Cdn',
        Effect: 'Allow',
        Action: [
          'cloudfront:CreateDistribution',
          'cloudfront:UpdateDistribution',
          'cloudfront:DeleteDistribution',
          'cloudfront:GetDistribution',
          'cloudfront:GetDistributionConfig',
          'cloudfront:CreateOriginAccessControl',
          'cloudfront:UpdateOriginAccessControl',
          'cloudfront:DeleteOriginAccessControl',
          'cloudfront:GetOriginAccessControl',
          'cloudfront:TagResource',
          'cloudfront:UntagResource',
          'cloudfront:ListTagsForResource',
        ],
        Resource: '*',
      },
      {
        Sid: 'HttpApis',
        Effect: 'Allow',
        Action: [
          'apigateway:GET',
          'apigateway:POST',
          'apigateway:PUT',
          'apigateway:PATCH',
          'apigateway:DELETE',
          'apigateway:TagResource',
        ],
        Resource: [
          `${P}:apigateway:*::/apis`,
          `${P}:apigateway:*::/apis/*`,
          `${P}:apigateway:*::/tags/*`,
        ],
      },
      {
        Sid: 'Functions',
        Effect: 'Allow',
        Action: [
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:GetFunctionConfiguration',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:AddPermission',
          'lambda:RemovePermission',
          'lambda:TagResource',
          'lambda:UntagResource',
          'lambda:ListTags',
        ],
        Resource: `${P}:lambda:*:\${AWS::AccountId}:function:${OWN}`,
      },
      {
        Sid: 'WebAdapterLayer',
        Effect: 'Allow',
        Action: ['lambda:GetLayerVersion'],
        Resource: `${P}:lambda:*:753240598075:layer:LambdaAdapterLayer*:*`,
      },
      {
        Sid: 'Tables',
        Effect: 'Allow',
        Action: [
          'dynamodb:CreateTable',
          'dynamodb:UpdateTable',
          'dynamodb:DeleteTable',
          'dynamodb:DescribeTable',
          'dynamodb:DescribeContinuousBackups',
          'dynamodb:UpdateContinuousBackups',
          'dynamodb:DescribeTimeToLive',
          'dynamodb:TagResource',
          'dynamodb:UntagResource',
          'dynamodb:ListTagsOfResource',
        ],
        Resource: `${P}:dynamodb:*:\${AWS::AccountId}:table/${OWN}`,
      },
      {
        Sid: 'Logs',
        Effect: 'Allow',
        Action: [
          'logs:CreateLogGroup',
          'logs:DeleteLogGroup',
          'logs:PutRetentionPolicy',
          'logs:DeleteRetentionPolicy',
          'logs:TagResource',
          'logs:UntagResource',
          'logs:ListTagsForResource',
          'logs:ListTagsLogGroup',
        ],
        Resource: `${P}:logs:*:\${AWS::AccountId}:log-group:*`,
      },
      {
        Sid: 'LogGroupLookup',
        Effect: 'Allow',
        Action: ['logs:DescribeLogGroups'],
        Resource: '*',
      },
      {
        Sid: 'Schedules',
        Effect: 'Allow',
        Action: [
          'scheduler:CreateSchedule',
          'scheduler:UpdateSchedule',
          'scheduler:DeleteSchedule',
          'scheduler:GetSchedule',
          'scheduler:TagResource',
        ],
        Resource: `${P}:scheduler:*:\${AWS::AccountId}:schedule/*/${OWN}`,
      },
      {
        Sid: 'Identity',
        Effect: 'Allow',
        Action: [
          'cognito-idp:CreateUserPool',
          'cognito-idp:UpdateUserPool',
          'cognito-idp:DeleteUserPool',
          'cognito-idp:DescribeUserPool',
          'cognito-idp:CreateUserPoolClient',
          'cognito-idp:UpdateUserPoolClient',
          'cognito-idp:DeleteUserPoolClient',
          'cognito-idp:DescribeUserPoolClient',
          'cognito-idp:SetUserPoolMfaConfig',
          'cognito-idp:GetUserPoolMfaConfig',
          'cognito-idp:TagResource',
        ],
        Resource: `${P}:cognito-idp:*:\${AWS::AccountId}:userpool/*`,
      },
      {
        Sid: 'Budget',
        Effect: 'Allow',
        Action: [
          'budgets:CreateBudget',
          'budgets:ModifyBudget',
          'budgets:DeleteBudget',
          'budgets:ViewBudget',
          'budgets:TagResource',
        ],
        Resource: `${P}:budgets::\${AWS::AccountId}:budget/*`,
      },
      {
        Sid: 'RolesUnderTheBoundary',
        Effect: 'Allow',
        Action: ['iam:CreateRole', 'iam:PutRolePolicy', 'iam:AttachRolePolicy'],
        Resource: `${P}:iam::\${AWS::AccountId}:role/${OWN}`,
        Condition: { StringEquals: { 'iam:PermissionsBoundary': boundaryArn } },
      },
      {
        Sid: 'RoleMaintenance',
        Effect: 'Allow',
        Action: [
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:DeleteRole',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:UpdateAssumeRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:ListRolePolicies',
          'iam:ListAttachedRolePolicies',
        ],
        Resource: `${P}:iam::\${AWS::AccountId}:role/${OWN}`,
      },
      {
        Sid: 'Network',
        Effect: 'Allow',
        Action: [
          'ec2:CreateVpc',
          'ec2:DeleteVpc',
          'ec2:ModifyVpcAttribute',
          'ec2:DescribeVpcs',
          'ec2:CreateSubnet',
          'ec2:DeleteSubnet',
          'ec2:ModifySubnetAttribute',
          'ec2:DescribeSubnets',
          'ec2:CreateRouteTable',
          'ec2:DeleteRouteTable',
          'ec2:CreateRoute',
          'ec2:DeleteRoute',
          'ec2:AssociateRouteTable',
          'ec2:DisassociateRouteTable',
          'ec2:DescribeRouteTables',
          'ec2:CreateInternetGateway',
          'ec2:DeleteInternetGateway',
          'ec2:AttachInternetGateway',
          'ec2:DetachInternetGateway',
          'ec2:DescribeInternetGateways',
          'ec2:CreateSecurityGroup',
          'ec2:DeleteSecurityGroup',
          'ec2:AuthorizeSecurityGroupIngress',
          'ec2:AuthorizeSecurityGroupEgress',
          'ec2:RevokeSecurityGroupIngress',
          'ec2:RevokeSecurityGroupEgress',
          'ec2:UpdateSecurityGroupRuleDescriptionsIngress',
          'ec2:UpdateSecurityGroupRuleDescriptionsEgress',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeSecurityGroupRules',
          'ec2:CreateFlowLogs',
          'ec2:DeleteFlowLogs',
          'ec2:DescribeFlowLogs',
          'ec2:DescribeAvailabilityZones',
          'ec2:DescribeNetworkInterfaces',
          'ec2:DescribeAccountAttributes',
          'ec2:CreateTags',
          'ec2:DeleteTags',
        ],
        Resource: '*',
      },
      {
        Sid: 'Containers',
        Effect: 'Allow',
        Action: [
          'ecs:CreateCluster',
          'ecs:DeleteCluster',
          'ecs:DescribeClusters',
          'ecs:CreateService',
          'ecs:UpdateService',
          'ecs:DeleteService',
          'ecs:DescribeServices',
          'ecs:RegisterTaskDefinition',
          'ecs:DeregisterTaskDefinition',
          'ecs:DescribeTaskDefinition',
          'ecs:TagResource',
          'ecs:UntagResource',
          'ecs:ListTagsForResource',
        ],
        Resource: '*',
      },
      {
        Sid: 'LoadBalancing',
        Effect: 'Allow',
        Action: [
          'elasticloadbalancing:CreateLoadBalancer',
          'elasticloadbalancing:DeleteLoadBalancer',
          'elasticloadbalancing:ModifyLoadBalancerAttributes',
          'elasticloadbalancing:DescribeLoadBalancers',
          'elasticloadbalancing:DescribeLoadBalancerAttributes',
          'elasticloadbalancing:SetSecurityGroups',
          'elasticloadbalancing:CreateTargetGroup',
          'elasticloadbalancing:DeleteTargetGroup',
          'elasticloadbalancing:ModifyTargetGroupAttributes',
          'elasticloadbalancing:DescribeTargetGroups',
          'elasticloadbalancing:DescribeTargetGroupAttributes',
          'elasticloadbalancing:DescribeTargetHealth',
          'elasticloadbalancing:RegisterTargets',
          'elasticloadbalancing:DeregisterTargets',
          'elasticloadbalancing:CreateListener',
          'elasticloadbalancing:DeleteListener',
          'elasticloadbalancing:ModifyListener',
          'elasticloadbalancing:DescribeListeners',
          'elasticloadbalancing:CreateRule',
          'elasticloadbalancing:DeleteRule',
          'elasticloadbalancing:ModifyRule',
          'elasticloadbalancing:DescribeRules',
          'elasticloadbalancing:AddTags',
          'elasticloadbalancing:RemoveTags',
          'elasticloadbalancing:DescribeTags',
        ],
        Resource: '*',
      },
      {
        Sid: 'Databases',
        Effect: 'Allow',
        Action: [
          'rds:CreateDBInstance',
          'rds:DeleteDBInstance',
          'rds:ModifyDBInstance',
          'rds:DescribeDBInstances',
          'rds:CreateDBSubnetGroup',
          'rds:DeleteDBSubnetGroup',
          'rds:DescribeDBSubnetGroups',
          'rds:CreateDBParameterGroup',
          'rds:DeleteDBParameterGroup',
          'rds:ModifyDBParameterGroup',
          'rds:DescribeDBParameterGroups',
          'rds:DescribeDBParameters',
          'rds:CreateDBSnapshot',
          'rds:DescribeDBSnapshots',
          'rds:AddTagsToResource',
          'rds:RemoveTagsFromResource',
          'rds:ListTagsForResource',
        ],
        Resource: '*',
      },
      {
        Sid: 'SharedFiles',
        Effect: 'Allow',
        Action: [
          'elasticfilesystem:CreateFileSystem',
          'elasticfilesystem:DeleteFileSystem',
          'elasticfilesystem:DescribeFileSystems',
          'elasticfilesystem:CreateMountTarget',
          'elasticfilesystem:DeleteMountTarget',
          'elasticfilesystem:DescribeMountTargets',
          'elasticfilesystem:DescribeMountTargetSecurityGroups',
          'elasticfilesystem:ModifyMountTargetSecurityGroups',
          'elasticfilesystem:CreateAccessPoint',
          'elasticfilesystem:DeleteAccessPoint',
          'elasticfilesystem:DescribeAccessPoints',
          'elasticfilesystem:PutBackupPolicy',
          'elasticfilesystem:DescribeBackupPolicy',
          'elasticfilesystem:PutLifecycleConfiguration',
          'elasticfilesystem:TagResource',
          'elasticfilesystem:UntagResource',
        ],
        Resource: '*',
      },
      {
        Sid: 'Images',
        Effect: 'Allow',
        Action: [
          'ecr:CreateRepository',
          'ecr:DeleteRepository',
          'ecr:DescribeRepositories',
          'ecr:PutImageScanningConfiguration',
          'ecr:PutImageTagMutability',
          'ecr:PutLifecyclePolicy',
          'ecr:DeleteLifecyclePolicy',
          'ecr:GetLifecyclePolicy',
          'ecr:TagResource',
          'ecr:ListTagsForResource',
        ],
        Resource: `${P}:ecr:*:\${AWS::AccountId}:repository/${OWN}`,
      },
      {
        Sid: 'Logins',
        Effect: 'Allow',
        Action: [
          'secretsmanager:CreateSecret',
          'secretsmanager:UpdateSecret',
          'secretsmanager:DeleteSecret',
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:TagResource',
          'secretsmanager:UntagResource',
          'secretsmanager:GetResourcePolicy',
        ],
        Resource: `${P}:secretsmanager:*:\${AWS::AccountId}:secret:${OWN}`,
      },
      {
        Sid: 'RandomPasswords',
        Effect: 'Allow',
        Action: ['secretsmanager:GetRandomPassword'],
        Resource: '*',
      },
      {
        Sid: 'ServiceRoles',
        Effect: 'Allow',
        Action: ['iam:CreateServiceLinkedRole'],
        Resource: '*',
        Condition: {
          StringEquals: {
            'iam:AWSServiceName': [
              'ecs.amazonaws.com',
              'elasticloadbalancing.amazonaws.com',
              'rds.amazonaws.com',
              'elasticfilesystem.amazonaws.com',
            ],
          },
        },
      },
      {
        Sid: 'PassRolesToOwnServices',
        Effect: 'Allow',
        Action: ['iam:PassRole'],
        Resource: `${P}:iam::\${AWS::AccountId}:role/${OWN}`,
        Condition: {
          StringEquals: {
            'iam:PassedToService': [
              'lambda.amazonaws.com',
              'scheduler.amazonaws.com',
              'ecs-tasks.amazonaws.com',
              'vpc-flow-logs.amazonaws.com',
            ],
          },
        },
      },
      {
        Sid: 'NeverChangeTheGuardrails',
        Effect: 'Deny',
        Action: [
          'iam:DeletePolicy',
          'iam:CreatePolicyVersion',
          'iam:DeletePolicyVersion',
          'iam:SetDefaultPolicyVersion',
          'iam:DeleteRolePermissionsBoundary',
          'iam:PutRolePermissionsBoundary',
        ],
        Resource: [
          boundaryArn,
          `${P}:iam::\${AWS::AccountId}:policy/${EXECUTION_POLICY_NAME}`,
          `${P}:iam::\${AWS::AccountId}:role/${OWN}`,
        ],
      },
    ],
  };
}

/**
 * What the deployer role may do: drive the toolkit's own roles, read and write the deployment's
 * stacks, buckets and parameters, start its builds, and clear the CDN. It cannot create users,
 * keys, or roles of its own, and it cannot touch anything outside Hero's names.
 */
export function deployerPolicy(): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'UseTheToolkitRoles',
        Effect: 'Allow',
        Action: ['sts:AssumeRole'],
        Resource: `${P}:iam::\${AWS::AccountId}:role/cdk-${BOOTSTRAP_QUALIFIER}-*`,
      },
      {
        Sid: 'Stacks',
        Effect: 'Allow',
        Action: [
          'cloudformation:DescribeStacks',
          'cloudformation:ListStackResources',
          'cloudformation:DescribeStackResources',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
          'cloudformation:DetectStackDrift',
          'cloudformation:DescribeStackDriftDetectionStatus',
        ],
        Resource: [
          `${P}:cloudformation:*:\${AWS::AccountId}:stack/${OWN}/*`,
          `${P}:cloudformation:*:\${AWS::AccountId}:stack/CDKToolkit-${BOOTSTRAP_QUALIFIER}/*`,
          `${P}:cloudformation:*:\${AWS::AccountId}:stack/${PREREQUISITES_STACK}/*`,
        ],
      },
      {
        Sid: 'ToolkitVersion',
        Effect: 'Allow',
        Action: ['ssm:GetParameter'],
        Resource: `${P}:ssm:*:\${AWS::AccountId}:parameter/cdk-bootstrap/${BOOTSTRAP_QUALIFIER}/version`,
      },
      {
        Sid: 'DeploymentParameters',
        Effect: 'Allow',
        Action: ['ssm:PutParameter', 'ssm:GetParameter', 'ssm:GetParametersByPath'],
        Resource: `${P}:ssm:*:\${AWS::AccountId}:parameter/hero/*`,
      },
      {
        Sid: 'DeploymentFiles',
        Effect: 'Allow',
        Action: [
          's3:PutObject',
          's3:GetObject',
          's3:DeleteObject',
          's3:ListBucket',
          's3:ListBucketVersions',
          's3:DeleteObjectVersion',
        ],
        Resource: [`${P}:s3:::${OWN}`, `${P}:s3:::${OWN}/*`],
      },
      {
        Sid: 'Builds',
        Effect: 'Allow',
        Action: ['codebuild:StartBuild', 'codebuild:BatchGetBuilds'],
        Resource: `${P}:codebuild:*:\${AWS::AccountId}:project/${OWN}`,
      },
      {
        Sid: 'ImagesOfThisDeployment',
        Effect: 'Allow',
        Action: ['ecr:ListImages', 'ecr:BatchDeleteImage', 'ecr:DescribeRepositories'],
        Resource: `${P}:ecr:*:\${AWS::AccountId}:repository/${OWN}`,
      },
      {
        Sid: 'ReadHealth',
        Effect: 'Allow',
        Action: [
          'elasticloadbalancing:DescribeTargetHealth',
          'elasticloadbalancing:DescribeTargetGroups',
        ],
        Resource: '*',
      },
      {
        Sid: 'ClearTheCdn',
        Effect: 'Allow',
        Action: ['cloudfront:CreateInvalidation'],
        Resource: `${P}:cloudfront::\${AWS::AccountId}:distribution/*`,
      },
    ],
  };
}

/** The CloudFormation template that creates the boundary and the execution policy. */
export function prerequisitesTemplate(): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Hero Cloud: the permission boundary every Hero role carries, and the limited policy CloudFormation uses in place of administrator access. Safe to keep; remove only after every Hero deployment is destroyed.',
    Resources: {
      DeployerPolicy: {
        Type: 'AWS::IAM::ManagedPolicy',
        Properties: {
          ManagedPolicyName: DEPLOYER_POLICY_NAME,
          PolicyDocument: { 'Fn::Sub': JSON.stringify(deployerPolicy()) },
        },
      },
      DeployerRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: DEPLOYER_ROLE_NAME,
          Description: 'Assumed by a person to run Hero deployments with limited permissions.',
          MaxSessionDuration: 3600,
          ManagedPolicyArns: [{ Ref: 'DeployerPolicy' }],
          // Any principal in this account that has been allowed to assume it, and nobody outside it.
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: {
                  AWS: { 'Fn::Sub': 'arn:${AWS::Partition}:iam::${AWS::AccountId}:root' },
                },
                Action: 'sts:AssumeRole',
              },
            ],
          },
        },
      },
      Boundary: {
        Type: 'AWS::IAM::ManagedPolicy',
        Properties: {
          ManagedPolicyName: BOUNDARY_POLICY_NAME,
          PolicyDocument: { 'Fn::Sub': JSON.stringify(boundaryPolicy()) },
        },
      },
      Execution: {
        Type: 'AWS::IAM::ManagedPolicy',
        Properties: {
          ManagedPolicyName: EXECUTION_POLICY_NAME,
          PolicyDocument: { 'Fn::Sub': JSON.stringify(executionPolicy()) },
        },
      },
    },
    Outputs: {
      BoundaryArn: { Value: { Ref: 'Boundary' } },
      ExecutionPolicyArn: { Value: { Ref: 'Execution' } },
      DeployerRoleArn: { Value: { 'Fn::GetAtt': ['DeployerRole', 'Arn'] } },
    },
  };
}
