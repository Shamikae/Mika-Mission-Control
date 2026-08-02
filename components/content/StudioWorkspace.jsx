import { useState } from 'react';
import ContentFactoryPackage from './ContentFactoryPackage';
import ContentPackGenerator from './ContentPackGenerator';
import ContentPackagePipeline from './ContentPackagePipeline';
import ContentBriefGenerator from '../sections/ContentBriefGenerator';
import ContentStudio from '../sections/ContentStudio';
import ContentArtifactsPanel from '../sections/ContentArtifactsPanel';
import AnalyticsRoom from '../sections/AnalyticsRoom';
import MikaTwinStudio from '../sections/MikaTwinStudio';
import ViralContentWorkflowPanel from '../sections/ViralContentWorkflowPanel';
import ContentWorkspace from '../workspaces/ContentWorkspace';
import CreativeAssetGallery from './CreativeAssetGallery';

const MODES = [
  { id: 'create', label: 'Create Brief' },
  { id: 'platform', label: 'Platform Studio' },
  { id: 'workflow', label: 'Viral Workflow' },
  { id: 'gallery', label: 'Asset Gallery' },
  { id: 'assets', label: 'Detailed Library' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'twin', label: 'Mika Twin' },
  { id: 'factory', label: 'Content Factory' },
  { id: 'content-pack', label: 'Content Pack' },
  { id: 'pack-pipeline', label: 'Package Pipeline' },
];

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'pinterest', label: 'Pinterest' },
  { id: 'twitter', label: 'X / Twitter' },
  { id: 'blog', label: 'Blog' },
  { id: 'podcast', label: 'Podcast' },
];

export default function StudioWorkspace() {
  const [mode, setMode] = useState('create');
  const [platform, setPlatform] = useState('tiktok');

  return (
    <ContentWorkspace
      title="Studio"
      description="Create governed briefs, work inside platform studios, and review durable content assets."
    >
      <div className="content-focus-tabs" role="tablist">
        {MODES.map(entry => (
          <button
            type="button"
            key={entry.id}
            className={mode === entry.id ? 'active' : ''}
            onClick={() => setMode(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {mode === 'platform' && (
        <div className="content-platform-picker">
          {PLATFORMS.map(entry => (
            <button
              type="button"
              key={entry.id}
              className={platform === entry.id ? 'active' : ''}
              onClick={() => setPlatform(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="content-existing-surface">
        {mode === 'create' && <ContentBriefGenerator />}
        {mode === 'platform' && <ContentStudio studioId={platform} />}
        {mode === 'workflow' && <ViralContentWorkflowPanel briefTaskId={null} />}
        {mode === 'gallery' && <CreativeAssetGallery />}
        {mode === 'assets' && <ContentArtifactsPanel />}
        {mode === 'analytics' && <AnalyticsRoom />}
        {mode === 'twin' && <MikaTwinStudio />}
        {mode === 'factory' && <ContentFactoryPackage />}
        {mode === 'content-pack' && <ContentPackGenerator />}
        {mode === 'pack-pipeline' && <ContentPackagePipeline />}
      </div>
    </ContentWorkspace>
  );
}
