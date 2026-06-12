import {
  DigitalDiamondSection,
  ManagedByMikaSection,
  MedAISection,
  CannaOpsSection,
  HotelHookerSection,
  AITwinSection,
  LeadRecoverySection,
} from '../sections/BrandSections';
import ProjectRoom from '../sections/ProjectRoom';
import WorkspaceTabs from './WorkspaceTabs';

export default function ProjectsWorkspace({ data }) {
  return (
    <WorkspaceTabs
      tabs={[
        {
          id: 'digital-diamond',
          label: 'Digital Diamond',
          content: <ProjectRoom projectId="digital-diamond"><DigitalDiamondSection /></ProjectRoom>,
        },
        {
          id: 'managed-by-mika',
          label: 'Managed by Mika',
          content: <ProjectRoom projectId="managed-by-mika"><ManagedByMikaSection /></ProjectRoom>,
        },
        {
          id: 'medai',
          label: 'MedAI',
          content: <ProjectRoom projectId="medai"><MedAISection data={data} /></ProjectRoom>,
        },
        {
          id: 'cannaops',
          label: 'CannaOps',
          content: <ProjectRoom projectId="cannaops"><CannaOpsSection data={data} /></ProjectRoom>,
        },
        {
          id: 'hotel-hooker',
          label: 'Hotel Hooker',
          content: <ProjectRoom projectId="hotel-hooker"><HotelHookerSection /></ProjectRoom>,
        },
        {
          id: 'ai-twin',
          label: 'AI Twin',
          content: <ProjectRoom projectId="ai-twin"><AITwinSection /></ProjectRoom>,
        },
        {
          id: 'lead-recovery',
          label: 'Lead Recovery',
          content: <ProjectRoom projectId="lead-recovery"><LeadRecoverySection data={data} /></ProjectRoom>,
        },
      ]}
    />
  );
}
