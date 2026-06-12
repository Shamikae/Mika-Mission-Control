import ExistingProjectsWorkspace from '../workspaces/ProjectsWorkspace';
import BusinessWorkspace from '../workspaces/BusinessWorkspace';

export default function ProjectsWorkspace({ data }) {
  return (
    <BusinessWorkspace
      title="Projects"
      description="Existing Mika project and brand rooms with overview, Kanban, journal, teams, and revenue."
    >
      <div className="business-existing-surface">
        <ExistingProjectsWorkspace data={data} />
      </div>
    </BusinessWorkspace>
  );
}
