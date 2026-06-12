import MarkdownDocument from '../vault/MarkdownDocument';
import SelfWorkspace from './SelfWorkspace';

const GUIDE = `# Build Guide
MIKA AGENTIC OS™ keeps work organized around six simple ideas.

## Workspace = command center
Use Mission Control to understand current signals. Use Diamond Control to form safe intents, Paperclip for its external workspace, and Boardroom for governed planning.

## Agents = workers
Agents are real registered workers. Capabilities and external workspaces are not presented as agents.

## Self = personal operating system
Goals set direction. Journal records decisions. Memory preserves context. Notebook organizes prompts, notes, research, and Obsidian relationships.

## Content = content engine
Move work through Pipeline, Studio, Video, Thumbnails, SEO, and Kanban. Existing approval and generation boundaries still apply.

## Business = money engine
Leads, Offers, Clients, Revenue, and Projects organize the existing Mika revenue and delivery systems.

## Wired = connected systems
The footer shows the small set of connected systems. Obsidian stays available there and inside Memory and Notebook context.

### Operating rule
- Navigate to the smallest workspace that owns the work.
- Review status and intent before triggering governed actions.
- Treat staged or unavailable connections honestly.
- Keep external, paid, destructive, and long-running actions behind Mika approvals.`;

export default function BuildGuide() {
  return (
    <SelfWorkspace
      eyebrow="SELF · OPERATING GUIDE"
      title="Build Guide"
      description="The simplified mental model for navigating and extending MIKA AGENTIC OS™."
    >
      <MarkdownDocument content={GUIDE} />
    </SelfWorkspace>
  );
}
