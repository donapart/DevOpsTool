import * as vscode from 'vscode';
import { ProjectManager, Project } from '../core/projects';
import { AccountColor, AccountColorLabels } from '../core/accounts';
import { logInfo, logError } from '../util/logging';

const TAG = 'ProjectCommands';

export function registerProjectCommands(
    context: vscode.ExtensionContext,
    projectManager: ProjectManager,
    onProjectsChanged: () => void
) {
    context.subscriptions.push(
        // =============================================
        // PROJECT MANAGEMENT
        // =============================================
        vscode.commands.registerCommand('devops.createProject', async () => {
            try {
                const name = await vscode.window.showInputBox({
                    prompt: 'Projektname eingeben',
                    placeHolder: 'z.B. "Production", "Staging", "Kunde XYZ"',
                    validateInput: (value) => {
                        if (!value || value.trim().length < 2) {
                            return 'Name muss mindestens 2 Zeichen haben';
                        }
                        return null;
                    }
                });

                if (!name) return;

                const colorOptions = Object.entries(AccountColorLabels).map(
                    ([key, label]) => ({ label, detail: key })
                );

                const selectedColor = await vscode.window.showQuickPick(colorOptions, {
                    placeHolder: 'Projektfarbe wählen'
                });

                if (!selectedColor) return;

                const tagsInput = await vscode.window.showInputBox({
                    prompt: 'Tags (kommagetrennt, optional)',
                    placeHolder: 'z.B. prod, customer-x, critical'
                });

                const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

                const description = await vscode.window.showInputBox({
                    prompt: 'Beschreibung (optional)',
                    placeHolder: 'Kurze Beschreibung des Projekts'
                });

                await projectManager.createProject(
                    name.trim(),
                    selectedColor.detail as AccountColor,
                    tags,
                    description || undefined
                );

                vscode.window.showInformationMessage(`✅ Projekt "${name}" erstellt!`);
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to create project', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.editProject', async (project?: Project) => {
            try {
                if (!project) {
                    const projects = projectManager.getAllProjects();
                    if (projects.length === 0) {
                        vscode.window.showInformationMessage('Keine Projekte vorhanden.');
                        return;
                    }

                    const options = projects.map(p => ({
                        label: `${AccountColorLabels[p.color].split(' ')[0]} ${p.name}`,
                        description: p.tags.join(', ') || 'Keine Tags',
                        detail: p.id
                    }));

                    const selected = await vscode.window.showQuickPick(options, {
                        placeHolder: 'Welches Projekt bearbeiten?'
                    });

                    if (!selected) return;
                    project = projectManager.getProject(selected.detail!);
                }

                if (!project) {
                    vscode.window.showErrorMessage('Projekt nicht gefunden.');
                    return;
                }

                const editOptions = [
                    { label: '📝 Name ändern', detail: 'name' },
                    { label: '🎨 Farbe ändern', detail: 'color' },
                    { label: '🏷️ Tags bearbeiten', detail: 'tags' },
                    { label: '📄 Beschreibung ändern', detail: 'description' }
                ];

                const editChoice = await vscode.window.showQuickPick(editOptions, {
                    placeHolder: `Was möchten Sie an "${project.name}" ändern?`
                });

                if (!editChoice) return;

                switch (editChoice.detail) {
                    case 'name': {
                        const newName = await vscode.window.showInputBox({
                            prompt: 'Neuer Name',
                            value: project.name
                        });
                        if (newName && newName !== project.name) {
                            await projectManager.updateProject(project.id, { name: newName });
                            vscode.window.showInformationMessage(`✅ Name geändert zu "${newName}"`);
                        }
                        break;
                    }
                    case 'color': {
                        const colorOptions = Object.entries(AccountColorLabels).map(
                            ([key, label]) => ({ label, detail: key })
                        );
                        const newColor = await vscode.window.showQuickPick(colorOptions, {
                            placeHolder: 'Neue Farbe wählen'
                        });
                        if (newColor) {
                            await projectManager.updateProject(project.id, { color: newColor.detail as AccountColor });
                            vscode.window.showInformationMessage(`✅ Farbe geändert!`);
                        }
                        break;
                    }
                    case 'tags': {
                        const currentTags = project.tags.join(', ');
                        const newTagsInput = await vscode.window.showInputBox({
                            prompt: 'Tags (kommagetrennt)',
                            value: currentTags
                        });
                        if (newTagsInput !== undefined) {
                            const tags = newTagsInput.split(',').map(t => t.trim()).filter(t => t);
                            await projectManager.updateProject(project.id, { tags });
                            vscode.window.showInformationMessage(`✅ Tags aktualisiert!`);
                        }
                        break;
                    }
                    case 'description': {
                        const newDesc = await vscode.window.showInputBox({
                            prompt: 'Neue Beschreibung',
                            value: project.description || ''
                        });
                        if (newDesc !== undefined) {
                            await projectManager.updateProject(project.id, { description: newDesc || undefined });
                            vscode.window.showInformationMessage(`✅ Beschreibung aktualisiert!`);
                        }
                        break;
                    }
                }

                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to edit project', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.deleteProject', async (project?: Project) => {
            try {
                if (!project) {
                    const projects = projectManager.getAllProjects();
                    if (projects.length === 0) {
                        vscode.window.showInformationMessage('Keine Projekte vorhanden.');
                        return;
                    }

                    const options = projects.map(p => ({
                        label: `${AccountColorLabels[p.color].split(' ')[0]} ${p.name}`,
                        detail: p.id
                    }));

                    const selected = await vscode.window.showQuickPick(options, {
                        placeHolder: 'Welches Projekt löschen?'
                    });

                    if (!selected) return;
                    project = projectManager.getProject(selected.detail!);
                }

                if (!project) {
                    vscode.window.showErrorMessage('Projekt nicht gefunden.');
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    `Projekt "${project.name}" wirklich löschen?`,
                    { modal: true },
                    'Ja, löschen',
                    'Abbrechen'
                );

                if (confirm !== 'Ja, löschen') return;

                await projectManager.deleteProject(project.id);
                vscode.window.showInformationMessage(`✅ Projekt "${project.name}" gelöscht.`);
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to delete project', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        // =============================================
        // RESOURCE METADATA (Assign Project/Tags to Domain/Server)
        // =============================================
        vscode.commands.registerCommand('devops.assignProject', async (resourceInfo?: { providerId: string; resourceId: string; name: string } | any) => {
            try {
                // Support both object and tree item
                let providerId: string | undefined;
                let resourceId: string | undefined;
                let name: string | undefined;

                if (resourceInfo) {
                    if (resourceInfo.providerId && resourceInfo.resourceId) {
                        // Direct object
                        providerId = resourceInfo.providerId;
                        resourceId = resourceInfo.resourceId;
                        name = resourceInfo.name || resourceInfo.resourceName || 'Resource';
                    } else if (resourceInfo.providerId || resourceInfo.resourceId) {
                        // Tree item with getters
                        providerId = resourceInfo.providerId || 'ionos-dns';
                        resourceId = resourceInfo.resourceId || resourceInfo.domain?.id || resourceInfo.server?.id;
                        name = resourceInfo.resourceName || resourceInfo.domain?.name || resourceInfo.server?.name || 'Resource';
                    }
                }

                if (!providerId || !resourceId) {
                    vscode.window.showWarningMessage('Bitte auf eine Domain oder einen Server klicken.');
                    return;
                }

                const projects = projectManager.getAllProjects();
                const options = [
                    { label: '$(circle-slash) Kein Projekt', detail: '__none__' },
                    ...projects.map(p => ({
                        label: `${AccountColorLabels[p.color].split(' ')[0]} ${p.name}`,
                        detail: p.id
                    })),
                    { label: '$(add) Neues Projekt erstellen', detail: '__create__' }
                ];

                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: `Projekt für "${name}" zuweisen`
                });

                if (!selected) return;

                if (selected.detail === '__create__') {
                    vscode.commands.executeCommand('devops.createProject');
                    return;
                }

                const projectId = selected.detail === '__none__' ? undefined : selected.detail;
                await projectManager.setResourceProject(providerId, resourceId, projectId!);

                vscode.window.showInformationMessage(
                    projectId 
                        ? `✅ Projekt zugewiesen!`
                        : `✅ Projektzuweisung entfernt.`
                );
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to assign project', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.editTags', async (resourceInfo?: { providerId: string; resourceId: string; name: string } | any) => {
            try {
                let providerId: string | undefined;
                let resourceId: string | undefined;
                let name: string | undefined;

                if (resourceInfo) {
                    if (resourceInfo.providerId && resourceInfo.resourceId) {
                        providerId = resourceInfo.providerId;
                        resourceId = resourceInfo.resourceId;
                        name = resourceInfo.name || resourceInfo.resourceName || 'Resource';
                    } else {
                        providerId = resourceInfo.providerId || 'ionos-dns';
                        resourceId = resourceInfo.resourceId || resourceInfo.domain?.id || resourceInfo.server?.id;
                        name = resourceInfo.resourceName || resourceInfo.domain?.name || resourceInfo.server?.name || 'Resource';
                    }
                }

                if (!providerId || !resourceId) {
                    vscode.window.showWarningMessage('Bitte auf eine Domain oder einen Server klicken.');
                    return;
                }

                const metadata = projectManager.getResourceMetadata(providerId, resourceId);
                const currentTags = metadata.tags.join(', ');

                const newTagsInput = await vscode.window.showInputBox({
                    prompt: `Tags für "${name}" (kommagetrennt)`,
                    value: currentTags,
                    placeHolder: 'z.B. prod, customer-x, critical'
                });

                if (newTagsInput === undefined) return;

                const tags = newTagsInput.split(',').map(t => t.trim()).filter(t => t);
                await projectManager.setResourceTags(providerId, resourceId, tags);

                vscode.window.showInformationMessage(`✅ Tags aktualisiert!`);
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to edit tags', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.setResourceColor', async (resourceInfo?: { providerId: string; resourceId: string; name: string } | any) => {
            try {
                let providerId: string | undefined;
                let resourceId: string | undefined;
                let name: string | undefined;

                if (resourceInfo) {
                    if (resourceInfo.providerId && resourceInfo.resourceId) {
                        providerId = resourceInfo.providerId;
                        resourceId = resourceInfo.resourceId;
                        name = resourceInfo.name || resourceInfo.resourceName || 'Resource';
                    } else {
                        providerId = resourceInfo.providerId || 'ionos-dns';
                        resourceId = resourceInfo.resourceId || resourceInfo.domain?.id || resourceInfo.server?.id;
                        name = resourceInfo.resourceName || resourceInfo.domain?.name || resourceInfo.server?.name || 'Resource';
                    }
                }

                if (!providerId || !resourceId) {
                    vscode.window.showWarningMessage('Bitte auf eine Domain oder einen Server klicken.');
                    return;
                }

                const colorOptions = [
                    { label: '$(circle-slash) Standardfarbe verwenden', detail: '__default__' },
                    ...Object.entries(AccountColorLabels).map(
                        ([key, label]) => ({ label, detail: key })
                    )
                ];

                const selected = await vscode.window.showQuickPick(colorOptions, {
                    placeHolder: `Farbe für "${name}" wählen`
                });

                if (!selected) return;

                const color = selected.detail === '__default__' ? undefined : selected.detail as AccountColor;
                await projectManager.setResourceColor(providerId, resourceId, color);

                vscode.window.showInformationMessage(`✅ Farbe gesetzt!`);
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to set resource color', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        }),

        vscode.commands.registerCommand('devops.addNote', async (resourceInfo?: { providerId: string; resourceId: string; name: string } | any) => {
            try {
                let providerId: string | undefined;
                let resourceId: string | undefined;
                let name: string | undefined;

                if (resourceInfo) {
                    if (resourceInfo.providerId && resourceInfo.resourceId) {
                        providerId = resourceInfo.providerId;
                        resourceId = resourceInfo.resourceId;
                        name = resourceInfo.name || resourceInfo.resourceName || 'Resource';
                    } else {
                        providerId = resourceInfo.providerId || 'ionos-dns';
                        resourceId = resourceInfo.resourceId || resourceInfo.domain?.id || resourceInfo.server?.id;
                        name = resourceInfo.resourceName || resourceInfo.domain?.name || resourceInfo.server?.name || 'Resource';
                    }
                }

                if (!providerId || !resourceId) {
                    vscode.window.showWarningMessage('Bitte auf eine Domain oder einen Server klicken.');
                    return;
                }

                const metadata = projectManager.getResourceMetadata(providerId, resourceId);
                const currentNote = metadata.notes || '';

                const newNote = await vscode.window.showInputBox({
                    prompt: `Notiz für "${name}"`,
                    value: currentNote,
                    placeHolder: 'Optionale Notiz oder Beschreibung'
                });

                if (newNote === undefined) return;

                await projectManager.setResourceNotes(providerId, resourceId, newNote || undefined);
                vscode.window.showInformationMessage(`✅ Notiz gespeichert!`);
                onProjectsChanged();
            } catch (err) {
                logError(TAG, 'Failed to add note', err);
                vscode.window.showErrorMessage(`Fehler: ${err}`);
            }
        })
    );
}
