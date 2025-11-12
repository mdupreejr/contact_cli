import { BaseTool, ToolConfig } from '../types/tools';
import { logger } from './logger';

export interface ToolRegistration {
  tool: BaseTool;
  enabled: boolean;
  selected: boolean;
  dependencies: string[];
  priority: number;
}

export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map();
  private executionOrder: string[] = [];

  /**
   * Register a tool with the registry
   */
  registerTool(
    tool: BaseTool, 
    options: {
      enabled?: boolean;
      dependencies?: string[];
      priority?: number;
    } = {}
  ): void {
    const registration: ToolRegistration = {
      tool,
      enabled: options.enabled ?? true,
      selected: false,
      dependencies: options.dependencies ?? [],
      priority: options.priority ?? 0,
    };

    this.tools.set(tool.name, registration);
    this.recalculateExecutionOrder();
    
    logger.debug(`Registered tool: ${tool.name}`);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(toolName: string): boolean {
    const removed = this.tools.delete(toolName);
    if (removed) {
      this.recalculateExecutionOrder();
      logger.debug(`Unregistered tool: ${toolName}`);
    }
    return removed;
  }

  /**
   * Get a specific tool by name
   */
  getTool(toolName: string): BaseTool | null {
    const registration = this.tools.get(toolName);
    return registration?.tool || null;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): ToolRegistration[] {
    return this.getAllTools().filter(reg => reg.enabled);
  }

  /**
   * Get currently selected tools for execution
   */
  getSelectedTools(): ToolRegistration[] {
    return this.getAllTools().filter(reg => reg.selected && reg.enabled);
  }

  /**
   * Set tool selection status
   */
  setToolSelection(toolName: string, selected: boolean): boolean {
    const registration = this.tools.get(toolName);
    if (registration && registration.enabled) {
      registration.selected = selected;
      return true;
    }
    return false;
  }

  /**
   * Select multiple tools at once
   */
  setMultipleToolSelection(selections: Record<string, boolean>): void {
    Object.entries(selections).forEach(([toolName, selected]) => {
      this.setToolSelection(toolName, selected);
    });
  }

  /**
   * Enable or disable a tool
   */
  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const registration = this.tools.get(toolName);
    if (registration) {
      registration.enabled = enabled;
      if (!enabled) {
        registration.selected = false;
      }
      return true;
    }
    return false;
  }

  /**
   * Get tools in optimal execution order (considering dependencies and priorities)
   */
  getExecutionOrder(): string[] {
    return [...this.executionOrder];
  }

  /**
   * Get selected tools in execution order
   */
  getSelectedToolsInOrder(): ToolRegistration[] {
    const selectedTools = this.getSelectedTools();
    const selectedNames = new Set(selectedTools.map(t => t.tool.name));
    
    return this.executionOrder
      .filter(toolName => selectedNames.has(toolName))
      .map(toolName => this.tools.get(toolName)!)
      .filter(Boolean);
  }

  /**
   * Validate that selected tools have their dependencies satisfied
   */
  validateDependencies(): { valid: boolean; missingDependencies: string[] } {
    const selectedTools = this.getSelectedTools();
    const selectedNames = new Set(selectedTools.map(t => t.tool.name));
    const missingDependencies: string[] = [];

    for (const registration of selectedTools) {
      for (const dependency of registration.dependencies) {
        if (!selectedNames.has(dependency)) {
          missingDependencies.push(`${registration.tool.name} requires ${dependency}`);
        }
      }
    }

    return {
      valid: missingDependencies.length === 0,
      missingDependencies,
    };
  }

  /**
   * Auto-select dependencies for currently selected tools
   */
  autoSelectDependencies(): string[] {
    const autoSelected: string[] = [];
    const selectedTools = this.getSelectedTools();
    
    for (const registration of selectedTools) {
      for (const dependency of registration.dependencies) {
        const depTool = this.tools.get(dependency);
        if (depTool && depTool.enabled && !depTool.selected) {
          depTool.selected = true;
          autoSelected.push(dependency);
        }
      }
    }

    return autoSelected;
  }

  /**
   * Get tool statistics
   */
  getStatistics(): {
    totalTools: number;
    enabledTools: number;
    selectedTools: number;
    toolsByCategory: Record<string, number>;
  } {
    const allTools = this.getAllTools();
    const enabledTools = this.getEnabledTools();
    const selectedTools = this.getSelectedTools();

    const toolsByCategory: Record<string, number> = {};
    allTools.forEach(reg => {
      const category = reg.tool.category;
      toolsByCategory[category] = (toolsByCategory[category] || 0) + 1;
    });

    return {
      totalTools: allTools.length,
      enabledTools: enabledTools.length,
      selectedTools: selectedTools.length,
      toolsByCategory,
    };
  }

  /**
   * Reset all tool selections
   */
  clearAllSelections(): void {
    this.tools.forEach(registration => {
      registration.selected = false;
    });
  }

  /**
   * Select all enabled tools
   */
  selectAllEnabled(): void {
    this.tools.forEach(registration => {
      if (registration.enabled) {
        registration.selected = true;
      }
    });
  }

  /**
   * Update tool configuration
   */
  updateToolConfig(toolName: string, config: Partial<ToolConfig>): boolean {
    const registration = this.tools.get(toolName);
    if (registration) {
      registration.tool.updateConfig(config);
      return true;
    }
    return false;
  }

  /**
   * Recalculate optimal execution order based on dependencies and priorities
   */
  private recalculateExecutionOrder(): void {
    const toolNames = Array.from(this.tools.keys());
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (toolName: string) => {
      if (visited.has(toolName)) return;
      if (visiting.has(toolName)) {
        throw new Error(`Circular dependency detected involving ${toolName}`);
      }

      visiting.add(toolName);
      const registration = this.tools.get(toolName);
      
      if (registration) {
        // Visit dependencies first
        for (const dependency of registration.dependencies) {
          if (this.tools.has(dependency)) {
            visit(dependency);
          }
        }
      }

      visiting.delete(toolName);
      visited.add(toolName);
      order.push(toolName);
    };

    // Sort by priority first, then resolve dependencies
    const sortedByPriority = toolNames.sort((a, b) => {
      const regA = this.tools.get(a)!;
      const regB = this.tools.get(b)!;
      return regB.priority - regA.priority; // Higher priority first
    });

    try {
      for (const toolName of sortedByPriority) {
        visit(toolName);
      }
      this.executionOrder = order;
    } catch (error) {
      logger.error('Failed to calculate execution order:', error);
      // Fallback to simple priority order
      this.executionOrder = sortedByPriority;
    }
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();