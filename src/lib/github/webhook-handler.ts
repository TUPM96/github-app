import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { serializeError } from "@/lib/errors";
import { parseBountyLabel } from "@/lib/github/bounty-label";
import { createIssueComment } from "@/lib/github/client";
import {
  bountyRegisteredMessage,
  inviteRequiredMessage,
  invoiceCreatedMessage,
} from "@/lib/github/messages";
import { extractLinkedIssueNumbers } from "@/lib/github/linked-issues";
import {
  createGithubInviteLink,
  createRewardInvoice,
  getPviumAccessTokenExpiresAt,
  refreshPviumAccessToken,
} from "@/lib/pvium/client";

type GithubWebhookPayload = Record<string, any>;

export async function handleGithubWebhook(params: {
  event: string;
  deliveryId: string;
  payload: GithubWebhookPayload;
}) {
  const action = params.payload.action;
  const pullRequest = params.payload.pull_request;

  console.log("[github-webhook] received", {
    deliveryId: params.deliveryId,
    event: params.event,
    action,
    repository: params.payload.repository?.full_name,
    sender: params.payload.sender?.login,
    issueNumber: params.payload.issue?.number,
    pullRequestNumber: pullRequest?.number,
    pullRequestMerged: pullRequest?.merged,
    pullRequestBaseBranch: pullRequest?.base?.ref,
    pullRequestHeadBranch: pullRequest?.head?.ref,
  });

  await prisma.webhookDelivery.upsert({
    where: { id: params.deliveryId },
    update: {},
    create: {
      id: params.deliveryId,
      event: params.event,
      action,
      repository: params.payload.repository?.full_name,
      sender: params.payload.sender?.login,
    },
  });

  if (params.event === "issues" && action === "labeled") {
    return handleIssueLabeled(params.payload);
  }

  if (
    params.event === "issues" &&
    ["edited", "closed", "reopened"].includes(action)
  ) {
    return handleIssueChanged(params.payload);
  }

  if (params.event === "pull_request" && action === "closed") {
    return handlePullRequestClosed(params.payload);
  }

  console.log("[github-webhook] ignored unsupported event/action", {
    deliveryId: params.deliveryId,
    event: params.event,
    action,
  });

  return { ignored: true };
}

async function upsertRepository(payload: GithubWebhookPayload) {
  const repository = payload.repository;
  const installationId = payload.installation?.id;

  if (!repository || !installationId) {
    throw new Error("Webhook payload missing repository or installation");
  }

  return prisma.repositoryInstallation.upsert({
    where: {
      owner_repo: {
        owner: repository.owner.login,
        repo: repository.name,
      },
    },
    update: {
      installationId,
      githubNodeId: repository.node_id,
    },
    create: {
      installationId,
      owner: repository.owner.login,
      repo: repository.name,
      githubNodeId: repository.node_id,
    },
  });
}

function getIssueMetadata(issue: GithubWebhookPayload["issue"]) {
  return {
    issueNodeId: textOrNull(issue?.node_id),
    issueTitle: textOrNull(issue?.title),
    issueUrl: textOrNull(issue?.html_url),
    issueState: textOrNull(issue?.state),
    issueBodyExcerpt: excerptOrNull(issue?.body),
    issueCreatedAt: dateOrNull(issue?.created_at),
    issueUpdatedAt: dateOrNull(issue?.updated_at),
  };
}

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function excerptOrNull(value: unknown) {
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  return normalized.length > 260
    ? `${normalized.slice(0, 257).trimEnd()}...`
    : normalized;
}

async function handleIssueLabeled(payload: GithubWebhookPayload) {
  const parsed = parseBountyLabel(payload.label?.name ?? "");
  if (!parsed) {
    console.log("[github-webhook] ignored issue label", {
      repository: payload.repository?.full_name,
      issueNumber: payload.issue?.number,
      label: payload.label?.name,
      reason: "Label is not a Pvium bounty label",
    });

    return { ignored: true };
  }

  const repository = await upsertRepository(payload);
  const issueMetadata = getIssueMetadata(payload.issue);
  const bounty = await prisma.bounty.upsert({
    where: {
      repositoryId_issueNumber_labelName: {
        repositoryId: repository.id,
        issueNumber: payload.issue.number,
        labelName: parsed.raw,
      },
    },
    update: {
      amount: parsed.amount,
      currency: parsed.currency,
      status: "OPEN",
      ...issueMetadata,
    },
    create: {
      repositoryId: repository.id,
      issueNumber: payload.issue.number,
      labelName: parsed.raw,
      amount: parsed.amount,
      currency: parsed.currency,
      ...issueMetadata,
    },
  });

  await createIssueComment({
    installationId: repository.installationId,
    owner: repository.owner,
    repo: repository.repo,
    issueNumber: payload.issue.number,
    body: bountyRegisteredMessage({
      amount: bounty.amount.toString(),
      currency: bounty.currency,
      issueNumber: bounty.issueNumber,
    }),
  });

  console.log("[github-webhook] bounty registered", {
    repository: payload.repository?.full_name,
    issueNumber: bounty.issueNumber,
    label: bounty.labelName,
    amount: bounty.amount.toString(),
    currency: bounty.currency,
  });

  return { bountyId: bounty.id };
}

async function handleIssueChanged(payload: GithubWebhookPayload) {
  const repository = payload.repository;
  const issueNumber = payload.issue?.number;

  if (!repository?.owner?.login || !repository?.name || !issueNumber) {
    return { ignored: true };
  }

  const installation = await prisma.repositoryInstallation.findUnique({
    where: {
      owner_repo: {
        owner: repository.owner.login,
        repo: repository.name,
      },
    },
  });

  if (!installation) {
    return { ignored: true };
  }

  const result = await prisma.bounty.updateMany({
    where: {
      repositoryId: installation.id,
      issueNumber,
    },
    data: getIssueMetadata(payload.issue),
  });

  console.log("[github-webhook] issue metadata synced", {
    repository: repository.full_name,
    issueNumber,
    bountyCount: result.count,
  });

  return { updated: result.count };
}

async function handlePullRequestClosed(payload: GithubWebhookPayload) {
  const env = getEnv();
  const pullRequest = payload.pull_request;
  if (!pullRequest?.merged) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest?.number,
      baseBranch: pullRequest?.base?.ref,
      headBranch: pullRequest?.head?.ref,
      merged: pullRequest?.merged,
      reason: "Pull request was closed without merge",
    });

    return { ignored: true };
  }

  const targetBranches = env.GITHUB_REWARD_TARGET_BRANCHES.split(",")
    .map((branch) => branch.trim())
    .filter(Boolean);

  console.log("[github-webhook] pull_request.closed branch check", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    baseBranch: pullRequest.base?.ref,
    headBranch: pullRequest.head?.ref,
    targetBranches,
  });

  if (!targetBranches.includes(pullRequest.base?.ref)) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest.number,
      baseBranch: pullRequest.base?.ref,
      targetBranches,
      reason: "Pull request target branch is not configured for rewards",
    });

    return {
      ignored: true,
      reason: "Pull request target branch is not configured for rewards",
      branch: pullRequest.base?.ref,
      targetBranches,
    };
  }

  const repository = await upsertRepository(payload);
  const linkedIssues = extractLinkedIssueNumbers(
    pullRequest.title,
    pullRequest.body,
  );

  console.log("[github-webhook] pull_request.closed linked issue check", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    linkedIssues,
  });

  if (!linkedIssues.length) {
    console.log("[github-webhook] ignored pull_request.closed", {
      repository: payload.repository?.full_name,
      pullRequestNumber: pullRequest.number,
      reason: "No closing issue references found",
    });

    return { ignored: true, reason: "No closing issue references found" };
  }

  const bounties = await prisma.bounty.findMany({
    where: {
      repositoryId: repository.id,
      issueNumber: { in: linkedIssues },
      status: "OPEN",
    },
  });

  console.log("[github-webhook] pull_request.closed bounty lookup", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    linkedIssues,
    openBountiesFound: bounties.length,
  });

  for (const bounty of bounties) {
    await processRewardForBounty({
      repository,
      bounty,
      pullRequest,
    });
  }

  console.log("[github-webhook] pull_request.closed processed", {
    repository: payload.repository?.full_name,
    pullRequestNumber: pullRequest.number,
    processedBounties: bounties.length,
  });

  return { processed: bounties.length };
}

async function processRewardForBounty(params: {
  repository: Awaited<ReturnType<typeof upsertRepository>>;
  bounty: any;
  pullRequest: any;
}) {
  const solverLogin = params.pullRequest.user.login;
  const solverGithubUserId = params.pullRequest.user.id;

  const githubUserLink = await prisma.githubUserLink.findFirst({
    where: {
      OR: [{ githubLogin: solverLogin }, { githubUserId: solverGithubUserId }],
    },
  });

  const savedAccessToken = githubUserLink
    ? await getUsablePviumAccessToken(githubUserLink)
    : null;

  console.log("[github-webhook] processing reward", {
    repository: `${params.repository.owner}/${params.repository.repo}`,
    issueNumber: params.bounty.issueNumber,
    pullRequestNumber: params.pullRequest.number,
    solverLogin,
    hasGithubUserLink: Boolean(githubUserLink),
    hasUsablePviumAccessToken: Boolean(savedAccessToken),
  });

  const reward = await prisma.rewardAttempt.upsert({
    where: {
      bountyId_pullRequestNumber_solverGithubLogin: {
        bountyId: params.bounty.id,
        pullRequestNumber: params.pullRequest.number,
        solverGithubLogin: solverLogin,
      },
    },
    update: {},
    create: {
      bountyId: params.bounty.id,
      githubUserLinkId: githubUserLink?.id,
      pullRequestNumber: params.pullRequest.number,
      pullRequestNodeId: params.pullRequest.node_id,
      solverGithubLogin: solverLogin,
      solverGithubUserId,
      status: savedAccessToken ? "INVOICE_CREATED" : "PENDING_INVITE",
    },
  });

  if (!savedAccessToken) {
    let inviteLink: string;
    try {
      inviteLink = await createGithubInviteLink({
        githubLogin: solverLogin,
        rewardAttemptId: reward.id,
      });
    } catch (error) {
      const serializedError = serializeError(error);
      console.error("[github-webhook] failed to create Pvium invite link", {
        repository: `${params.repository.owner}/${params.repository.repo}`,
        issueNumber: params.bounty.issueNumber,
        pullRequestNumber: params.pullRequest.number,
        solverLogin,
        rewardAttemptId: reward.id,
        error: serializedError,
        errorJson: JSON.stringify(serializedError),
      });

      throw error;
    }

    await prisma.rewardAttempt.update({
      where: { id: reward.id },
      data: {
        pviumInviteLink: inviteLink,
        status: "WAITING_FOR_ACCEPTANCE",
      },
    });

    await createIssueComment({
      installationId: params.repository.installationId,
      owner: params.repository.owner,
      repo: params.repository.repo,
      issueNumber: params.pullRequest.number,
      body: inviteRequiredMessage({
        githubLogin: solverLogin,
        inviteLink,
        amount: params.bounty.amount.toString(),
        currency: params.bounty.currency,
      }),
    });

    console.log("[github-webhook] invite comment posted", {
      repository: `${params.repository.owner}/${params.repository.repo}`,
      issueNumber: params.bounty.issueNumber,
      pullRequestNumber: params.pullRequest.number,
      solverLogin,
      rewardAttemptId: reward.id,
    });

    return;
  }

  let invoice: Awaited<ReturnType<typeof createRewardInvoice>>;
  try {
    invoice = await createRewardInvoice({
      amount: Number(params.bounty.amount),
      currency: params.bounty.currency,
      title: `Pvium GitHub reward for ${params.repository.owner}/${params.repository.repo}#${params.pullRequest.number}`,
      description: `Reward for @${solverLogin} after merged PR #${params.pullRequest.number}.`,
      githubLogin: solverLogin,
      accessToken: savedAccessToken,
    });
  } catch (error) {
    const serializedError = serializeError(error);
    console.error("[github-webhook] failed to create Pvium payment link", {
      repository: `${params.repository.owner}/${params.repository.repo}`,
      issueNumber: params.bounty.issueNumber,
      pullRequestNumber: params.pullRequest.number,
      solverLogin,
      rewardAttemptId: reward.id,
      error: serializedError,
      errorJson: JSON.stringify(serializedError),
    });

    throw error;
  }

  await prisma.rewardAttempt.update({
    where: { id: reward.id },
    data: {
      githubUserLinkId: githubUserLink?.id,
      pviumInvoiceId: invoice.id,
      pviumInvoiceUrl: invoice.url,
      status: "INVOICE_CREATED",
    },
  });

  await prisma.bounty.update({
    where: { id: params.bounty.id },
    data: { status: "INVOICE_CREATED" },
  });

  await createIssueComment({
    installationId: params.repository.installationId,
    owner: params.repository.owner,
    repo: params.repository.repo,
    issueNumber: params.pullRequest.number,
    body: invoiceCreatedMessage({
      githubLogin: solverLogin,
      invoiceUrl: invoice.url,
      amount: params.bounty.amount.toString(),
      currency: params.bounty.currency,
    }),
  });

  console.log("[github-webhook] payment link comment posted", {
    repository: `${params.repository.owner}/${params.repository.repo}`,
    issueNumber: params.bounty.issueNumber,
    pullRequestNumber: params.pullRequest.number,
    solverLogin,
    rewardAttemptId: reward.id,
    paymentId: invoice.id,
  });
}

async function getUsablePviumAccessToken(githubUserLink: {
  id: string;
  pviumAccessToken?: string | null;
  pviumRefreshToken?: string | null;
  pviumAccessTokenExpiresAt?: Date | null;
}) {
  if (!githubUserLink.pviumAccessToken) return null;

  const refreshBufferMs = 60_000;
  const expiresAt = githubUserLink.pviumAccessTokenExpiresAt?.getTime();
  if (expiresAt && expiresAt - refreshBufferMs > Date.now()) {
    return githubUserLink.pviumAccessToken;
  }

  if (!githubUserLink.pviumRefreshToken) return null;

  let refreshed: Awaited<ReturnType<typeof refreshPviumAccessToken>>;
  try {
    refreshed = await refreshPviumAccessToken(githubUserLink.pviumRefreshToken);
  } catch {
    return null;
  }
  const accessToken = refreshed.data.accessToken;

  await prisma.githubUserLink.update({
    where: { id: githubUserLink.id },
    data: {
      pviumAccessToken: accessToken,
      pviumRefreshToken:
        refreshed.data.refreshToken ?? githubUserLink.pviumRefreshToken,
      pviumTokenType: refreshed.data.tokenType,
      pviumAccessTokenExpiresAt: getPviumAccessTokenExpiresAt(refreshed.data),
    },
  });

  return accessToken;
}
