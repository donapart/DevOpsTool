import * as vscode from 'vscode';
import { AccountColor, AccountColorMap } from './accounts';

const PROJECTS_KEY = 'devops.projects';

export interface Project {
  id: string;
  name: string;
  color: AccountColor;
  tags: string[];
  description?: string;
}

export interface ResourceMetadata {
  projectId?: string;
  tags: string[];
  customColor?: AccountColor;
  notes?: string;
}

interface ProjectsStore {
  projects: Project[];
  resourceMetadata: Record<string, ResourceMetadata>; // key: "provider:resourceId"
}

/**
 * Manages projects, tags, and custom colors for domains/servers.
 */
export class ProjectManager {
  private projects: Project[] = [];
  private resourceMetadata: Map<string, ResourceMetadata> = new Map();

  constructor(private globalState: vscode.Memento) {}

  async initialize(): Promise<void> {
    const stored = this.globalState.get<ProjectsStore>(PROJECTS_KEY);
    this.projects = stored?.projects || [];
    
    if (stored?.resourceMetadata) {
      this.resourceMetadata = new Map(Object.entries(stored.resourceMetadata));
    }
  }

  // =============================================
  // PROJECT MANAGEMENT
  // =============================================

  getAllProjects(): Project[] {
    return [...this.projects];
  }

  getProject(id: string): Project | undefined {
    return this.projects.find(p => p.id === id);
  }

  async createProject(name: string, color: AccountColor, tags: string[] = [], description?: string): Promise<Project> {
    const id = `project-${Date.now()}`;
    const project: Project = {
      id,
      name,
      color,
      tags,
      description
    };

    this.projects.push(project);
    await this.save();
    return project;
  }

  async updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'color' | 'tags' | 'description'>>): Promise<void> {
    const project = this.projects.find(p => p.id === id);
    if (!project) throw new Error(`Project ${id} not found`);

    if (updates.name !== undefined) project.name = updates.name;
    if (updates.color !== undefined) project.color = updates.color;
    if (updates.tags !== undefined) project.tags = updates.tags;
    if (updates.description !== undefined) project.description = updates.description;

    await this.save();
  }

  async deleteProject(id: string): Promise<void> {
    const index = this.projects.findIndex(p => p.id === id);
    if (index === -1) throw new Error(`Project ${id} not found`);

    this.projects.splice(index, 1);
    
    // Remove project from all resources
    for (const [key, metadata] of this.resourceMetadata.entries()) {
      if (metadata.projectId === id) {
        metadata.projectId = undefined;
      }
    }

    await this.save();
  }

  // =============================================
  // RESOURCE METADATA (Domains/Servers)
  // =============================================

  getResourceKey(providerId: string, resourceId: string): string {
    return `${providerId}:${resourceId}`;
  }

  getResourceMetadata(providerId: string, resourceId: string): ResourceMetadata {
    const key = this.getResourceKey(providerId, resourceId);
    return this.resourceMetadata.get(key) || { tags: [] };
  }

  async setResourceProject(providerId: string, resourceId: string, projectId: string | undefined): Promise<void> {
    const key = this.getResourceKey(providerId, resourceId);
    const metadata = this.resourceMetadata.get(key) || { tags: [] };
    metadata.projectId = projectId;
    this.resourceMetadata.set(key, metadata);
    await this.save();
  }

  async setResourceTags(providerId: string, resourceId: string, tags: string[]): Promise<void> {
    const key = this.getResourceKey(providerId, resourceId);
    const metadata = this.resourceMetadata.get(key) || { tags: [] };
    metadata.tags = tags;
    this.resourceMetadata.set(key, metadata);
    await this.save();
  }

  async setResourceColor(providerId: string, resourceId: string, color: AccountColor | undefined): Promise<void> {
    const key = this.getResourceKey(providerId, resourceId);
    const metadata = this.resourceMetadata.get(key) || { tags: [] };
    metadata.customColor = color;
    this.resourceMetadata.set(key, metadata);
    await this.save();
  }

  async setResourceNotes(providerId: string, resourceId: string, notes: string | undefined): Promise<void> {
    const key = this.getResourceKey(providerId, resourceId);
    const metadata = this.resourceMetadata.get(key) || { tags: [] };
    metadata.notes = notes;
    this.resourceMetadata.set(key, metadata);
    await this.save();
  }

  getResourceColor(providerId: string, resourceId: string, accountColor: string): string {
    const metadata = this.getResourceMetadata(providerId, resourceId);
    
    // Custom color has priority
    if (metadata.customColor) {
      return AccountColorMap[metadata.customColor];
    }
    
    // Then project color
    if (metadata.projectId) {
      const project = this.getProject(metadata.projectId);
      if (project) {
        return AccountColorMap[project.color];
      }
    }
    
    // Fallback to account color
    return accountColor;
  }

  getResourceDisplayInfo(providerId: string, resourceId: string): {
    project?: Project;
    tags: string[];
    color: string;
    notes?: string;
  } {
    const metadata = this.getResourceMetadata(providerId, resourceId);
    const project = metadata.projectId ? this.getProject(metadata.projectId) : undefined;
    
    return {
      project,
      tags: metadata.tags || [],
      color: metadata.customColor ? AccountColorMap[metadata.customColor] : 
            (project ? AccountColorMap[project.color] : ''),
      notes: metadata.notes
    };
  }

  // =============================================
  // PERSISTENCE
  // =============================================

  private async save(): Promise<void> {
    const store: ProjectsStore = {
      projects: this.projects,
      resourceMetadata: Object.fromEntries(this.resourceMetadata)
    };
    await this.globalState.update(PROJECTS_KEY, store);
  }
}
