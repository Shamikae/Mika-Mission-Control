import { GoalsSection } from '../sections/IntelligenceSections';
import SelfWorkspace from './SelfWorkspace';

export default function GoalsWorkspace({ data }) {
  return (
    <SelfWorkspace
      title="Goals"
      description="Set direction, break goals into work, and use the existing Mika-to-Obsidian sync."
    >
      <GoalsSection data={data} />
    </SelfWorkspace>
  );
}
