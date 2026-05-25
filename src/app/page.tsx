import IssueDiscovery, { type DiscoveryIssue } from "./issue-discovery";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const issues = await loadBountyIssues();

  return <IssueDiscovery initialIssues={issues} />;
}

async function loadBountyIssues(): Promise<DiscoveryIssue[]> {
  try {
    const bounties = await prisma.bounty.findMany({
      include: {
        repository: true,
      },
      orderBy: [
        {
          issueUpdatedAt: {
            sort: "desc",
            nulls: "last",
          },
        },
        {
          updatedAt: "desc",
        },
      ],
      take: 200,
    });

    return bounties.map((bounty) => {
      const repositoryName = `${bounty.repository.owner}/${bounty.repository.repo}`;
      const issueUrl =
        bounty.issueUrl ??
        `https://github.com/${repositoryName}/issues/${bounty.issueNumber}`;
      const createdAt = bounty.issueCreatedAt ?? bounty.createdAt;
      const updatedAt = bounty.issueUpdatedAt ?? bounty.updatedAt;

      return {
        id: bounty.id,
        title: bounty.issueTitle ?? `Issue #${bounty.issueNumber}`,
        repositoryName,
        issueNumber: bounty.issueNumber,
        issueUrl,
        amount: Number(bounty.amount),
        currency: bounty.currency,
        status:
          bounty.status === "OPEN"
            ? (bounty.issueState ?? bounty.status)
            : bounty.status,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        excerpt: bounty.issueBodyExcerpt,
        labelName: bounty.labelName,
      };
    });
  } catch (error) {
    console.error("[issue-discovery] failed to load bounty issues", error);
    return [];
  }
}
