import { CampaignDetailsView } from "@/components/campaign-details";
import { Workspace } from "@/components/workspace";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = /^[1-9]\d*$/.test(id) ? Number(id) : NaN;
  return (
    <Workspace>
      <CampaignDetailsView key={id} campaignId={campaignId} />
    </Workspace>
  );
}
