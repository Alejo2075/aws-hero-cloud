import { BOOTSTRAP_QUALIFIER, BOUNDARY_POLICY_NAME } from '../cdk/names.js';

/** The name of the managed policy CloudFormation uses to create a deployment's resources. */
export const EXECUTION_POLICY_NAME = 'hero-cfn-execution';
/** The stack that holds the two policies, deployed before the CDK bootstrap stack. */
export const PREREQUISITES_STACK = 'hero-prerequisites';

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
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: `${P}:logs:*:\${AWS::AccountId}:log-group:*`,
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
        Condition: { StringEquals: { 'kms:ViaService': 'ssm.*.amazonaws.com' } },
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
        Sid: 'PassRolesToOwnServices',
        Effect: 'Allow',
        Action: ['iam:PassRole'],
        Resource: `${P}:iam::\${AWS::AccountId}:role/${OWN}`,
        Condition: {
          StringEquals: {
            'iam:PassedToService': ['lambda.amazonaws.com', 'scheduler.amazonaws.com'],
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

/** The CloudFormation template that creates the boundary and the execution policy. */
export function prerequisitesTemplate(): Record<string, unknown> {
  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Hero Cloud: the permission boundary every Hero role carries, and the limited policy CloudFormation uses in place of administrator access. Safe to keep; remove only after every Hero deployment is destroyed.',
    Resources: {
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
    },
  };
}
