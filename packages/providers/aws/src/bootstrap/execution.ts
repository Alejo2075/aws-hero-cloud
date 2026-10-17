import type { PolicyDocument, PolicyStatement } from './policies.js';

const P = 'arn:${AWS::Partition}';
const ACCOUNT = '${AWS::AccountId}';
const OWN = 'hero-*';

/** Everything Hero creates carries the deployment tag, so mutations can be limited to it. */
const TAGGED = { StringLike: { 'aws:ResourceTag/hero:deployment-id': OWN } } as const;
const CREATED_TAGGED = { StringLike: { 'aws:RequestTag/hero:deployment-id': OWN } } as const;

const allow = (
  Sid: string,
  Action: readonly string[],
  Resource: string | readonly string[],
  Condition?: PolicyStatement['Condition'],
): PolicyStatement => ({
  Sid,
  Effect: 'Allow',
  Action,
  Resource,
  ...(Condition === undefined ? {} : { Condition }),
});

/**
 * Network permissions. Creating anything needs the deployment tag on the new resource; changing or
 * deleting anything needs the tag on the resource it touches; reading is open because it changes
 * nothing. A tag can be set only while creating, so it cannot be put on someone else's resource.
 */
export function networkStatements(): PolicyStatement[] {
  return [
    allow(
      'NetworkRead',
      [
        'ec2:DescribeVpcs',
        'ec2:DescribeSubnets',
        'ec2:DescribeRouteTables',
        'ec2:DescribeInternetGateways',
        'ec2:DescribeSecurityGroups',
        'ec2:DescribeSecurityGroupRules',
        'ec2:DescribeFlowLogs',
        'ec2:DescribeAvailabilityZones',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DescribeAccountAttributes',
      ],
      '*',
    ),
    allow(
      'NetworkCreate',
      [
        'ec2:CreateVpc',
        'ec2:CreateSubnet',
        'ec2:CreateRouteTable',
        'ec2:CreateInternetGateway',
        'ec2:CreateSecurityGroup',
        'ec2:CreateFlowLogs',
      ],
      '*',
      CREATED_TAGGED,
    ),
    allow('NetworkTagWhileCreating', ['ec2:CreateTags'], '*', {
      StringEquals: {
        'ec2:CreateAction': [
          'CreateVpc',
          'CreateSubnet',
          'CreateRouteTable',
          'CreateInternetGateway',
          'CreateSecurityGroup',
          'CreateFlowLogs',
        ],
      },
    }),
    allow(
      'NetworkChange',
      [
        'ec2:DeleteVpc',
        'ec2:ModifyVpcAttribute',
        'ec2:DeleteSubnet',
        'ec2:ModifySubnetAttribute',
        'ec2:DeleteRouteTable',
        'ec2:CreateRoute',
        'ec2:DeleteRoute',
        'ec2:AssociateRouteTable',
        'ec2:DisassociateRouteTable',
        'ec2:DeleteInternetGateway',
        'ec2:AttachInternetGateway',
        'ec2:DetachInternetGateway',
        'ec2:DeleteSecurityGroup',
        'ec2:AuthorizeSecurityGroupIngress',
        'ec2:AuthorizeSecurityGroupEgress',
        'ec2:RevokeSecurityGroupIngress',
        'ec2:RevokeSecurityGroupEgress',
        'ec2:UpdateSecurityGroupRuleDescriptionsIngress',
        'ec2:UpdateSecurityGroupRuleDescriptionsEgress',
        'ec2:DeleteFlowLogs',
        'ec2:DeleteTags',
      ],
      '*',
      TAGGED,
    ),
  ];
}

/** Containers, load balancing, databases, shared files, images, and logins. */
export function containerStatements(): PolicyStatement[] {
  return [
    allow(
      'ContainerRead',
      [
        'ecs:DescribeClusters',
        'ecs:DescribeServices',
        'ecs:DescribeTaskDefinition',
        'ecs:DeregisterTaskDefinition',
        'ecs:RegisterTaskDefinition',
        'ecs:ListTagsForResource',
        'elasticloadbalancing:DescribeLoadBalancers',
        'elasticloadbalancing:DescribeLoadBalancerAttributes',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetGroupAttributes',
        'elasticloadbalancing:DescribeTargetHealth',
        'elasticloadbalancing:DescribeListeners',
        'elasticloadbalancing:DescribeRules',
        'elasticloadbalancing:DescribeTags',
        'rds:DescribeDBInstances',
        'rds:DescribeDBSubnetGroups',
        'rds:DescribeDBParameterGroups',
        'rds:DescribeDBParameters',
        'rds:DescribeDBSnapshots',
        'rds:ListTagsForResource',
        'elasticfilesystem:DescribeFileSystems',
        'elasticfilesystem:DescribeMountTargets',
        'elasticfilesystem:DescribeMountTargetSecurityGroups',
        'elasticfilesystem:DescribeAccessPoints',
        'elasticfilesystem:DescribeBackupPolicy',
        'secretsmanager:GetRandomPassword',
      ],
      '*',
    ),
    allow(
      'ContainerCreate',
      [
        'ecs:CreateCluster',
        'ecs:CreateService',
        'elasticloadbalancing:CreateLoadBalancer',
        'elasticloadbalancing:CreateTargetGroup',
        'rds:CreateDBInstance',
        'rds:CreateDBSubnetGroup',
        'rds:CreateDBParameterGroup',
        'elasticfilesystem:CreateFileSystem',
        'elasticfilesystem:CreateAccessPoint',
      ],
      '*',
      CREATED_TAGGED,
    ),
    allow(
      'ContainerChange',
      [
        'ecs:UpdateService',
        'ecs:DeleteService',
        'ecs:DeleteCluster',
        'ecs:TagResource',
        'ecs:UntagResource',
      ],
      [`${P}:ecs:*:${ACCOUNT}:cluster/${OWN}`, `${P}:ecs:*:${ACCOUNT}:service/${OWN}/${OWN}`],
    ),
    allow(
      'LoadBalancerChange',
      [
        'elasticloadbalancing:DeleteLoadBalancer',
        'elasticloadbalancing:ModifyLoadBalancerAttributes',
        'elasticloadbalancing:SetSecurityGroups',
        'elasticloadbalancing:DeleteTargetGroup',
        'elasticloadbalancing:ModifyTargetGroupAttributes',
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets',
        'elasticloadbalancing:CreateListener',
        'elasticloadbalancing:DeleteListener',
        'elasticloadbalancing:ModifyListener',
        'elasticloadbalancing:CreateRule',
        'elasticloadbalancing:DeleteRule',
        'elasticloadbalancing:ModifyRule',
        'elasticloadbalancing:AddTags',
        'elasticloadbalancing:RemoveTags',
      ],
      [
        `${P}:elasticloadbalancing:*:${ACCOUNT}:loadbalancer/app/${OWN}/*`,
        `${P}:elasticloadbalancing:*:${ACCOUNT}:targetgroup/${OWN}/*`,
        `${P}:elasticloadbalancing:*:${ACCOUNT}:listener/app/${OWN}/*/*`,
        `${P}:elasticloadbalancing:*:${ACCOUNT}:listener-rule/app/${OWN}/*/*/*`,
      ],
    ),
    allow(
      'DatabaseChange',
      [
        'rds:DeleteDBInstance',
        'rds:ModifyDBInstance',
        'rds:CreateDBSnapshot',
        'rds:DeleteDBSubnetGroup',
        'rds:DeleteDBParameterGroup',
        'rds:ModifyDBParameterGroup',
        'rds:AddTagsToResource',
        'rds:RemoveTagsFromResource',
      ],
      [
        `${P}:rds:*:${ACCOUNT}:db:${OWN}`,
        `${P}:rds:*:${ACCOUNT}:subgrp:${OWN}`,
        `${P}:rds:*:${ACCOUNT}:pg:${OWN}`,
        `${P}:rds:*:${ACCOUNT}:snapshot:${OWN}`,
      ],
    ),
    allow(
      'SharedFilesChange',
      [
        'elasticfilesystem:DeleteFileSystem',
        'elasticfilesystem:CreateMountTarget',
        'elasticfilesystem:DeleteMountTarget',
        'elasticfilesystem:ModifyMountTargetSecurityGroups',
        'elasticfilesystem:DeleteAccessPoint',
        'elasticfilesystem:PutBackupPolicy',
        'elasticfilesystem:PutLifecycleConfiguration',
        'elasticfilesystem:TagResource',
        'elasticfilesystem:UntagResource',
      ],
      `${P}:elasticfilesystem:*:${ACCOUNT}:*/*`,
      TAGGED,
    ),
    allow(
      'Images',
      [
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
      `${P}:ecr:*:${ACCOUNT}:repository/${OWN}`,
    ),
    allow(
      'Logins',
      [
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
      `${P}:secretsmanager:*:${ACCOUNT}:secret:${OWN}`,
    ),
    allow('ServiceRoles', ['iam:CreateServiceLinkedRole'], '*', {
      StringEquals: {
        'iam:AWSServiceName': [
          'ecs.amazonaws.com',
          'elasticloadbalancing.amazonaws.com',
          'rds.amazonaws.com',
          'elasticfilesystem.amazonaws.com',
        ],
      },
    }),
  ];
}

export interface NamedPolicy {
  /** Suffix of the managed policy name, such as `network`. */
  readonly suffix: string;
  readonly document: PolicyDocument;
}

export const asDocument = (Statement: PolicyStatement[]): PolicyDocument => ({
  Version: '2012-10-17',
  Statement,
});
