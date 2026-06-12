import RevenueTracking from '../sections/RevenueTracking';
import RevenueOpportunities from '../sections/RevenueOpportunities';
import ProposalCenter from '../sections/ProposalCenter';
import WorkspaceTabs from './WorkspaceTabs';

export default function RevenueWorkspace() {
  return (
    <WorkspaceTabs
      tabs={[
        { id: 'tracking', label: 'Revenue', content: <RevenueTracking /> },
        { id: 'opportunities', label: 'Opportunities', content: <RevenueOpportunities /> },
        { id: 'proposals', label: 'Proposals', content: <ProposalCenter /> },
      ]}
    />
  );
}
