import { JournalSection } from '../sections/IntelligenceSections';
import SelfWorkspace from './SelfWorkspace';

export default function JournalWorkspace({ data }) {
  return (
    <SelfWorkspace
      title="Journal"
      description="Capture daily decisions, progress, and reflections through Mika's existing vault-backed journal."
    >
      <JournalSection data={data} />
    </SelfWorkspace>
  );
}
