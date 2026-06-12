import HermesStatus from '../sections/HermesStatus';
import HermesChat from '../sections/HermesChat';
import WorkspaceTabs from './WorkspaceTabs';

export default function HermesWorkspace({ data }) {
  return (
    <WorkspaceTabs
      tabs={[
        { id: 'status', label: 'Status', content: <HermesStatus data={data} /> },
        { id: 'chat', label: 'Chat', content: <HermesChat /> },
      ]}
    />
  );
}
