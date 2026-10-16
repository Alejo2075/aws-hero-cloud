export type HeroPhase = 'load' | 'analyze' | 'plan' | 'approve' | 'deploy' | 'verify' | 'destroy';

/**
 * Progress every interface can show: a terminal spinner, Studio over server-sent events, or an
 * MCP progress notification. Events carry codes and parameters, not sentences.
 */
export type HeroEvent =
  | {
      readonly type: 'phase';
      readonly phase: HeroPhase;
      readonly status: 'started' | 'completed' | 'failed';
      readonly at: string;
    }
  | {
      readonly type: 'change';
      readonly changeId: string;
      readonly status: 'pending' | 'in-progress' | 'done' | 'failed';
    }
  | {
      readonly type: 'notice';
      readonly level: 'info' | 'warning';
      readonly code: string;
      readonly params?: Readonly<Record<string, string | number | boolean>>;
    };

export type HeroEventListener = (event: HeroEvent) => void;
