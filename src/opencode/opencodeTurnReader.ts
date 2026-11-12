/** One opencode turn as Claude Code mod events need it. */
export interface OpencodeTurn {
  readonly turnId: string;
  readonly prompt: string;
  readonly skills: readonly string[];
  readonly calls: readonly { readonly tool: string; readonly input: Record<string, unknown>; readonly resultText: string; readonly isError: boolean }[];
  readonly answer: string;
  readonly durationMs: number;
  readonly outputTokens: number;
  readonly reason: string;
}

type ToolPart = {
  readonly type?: string;
  readonly name?: string;
  readonly state?: { readonly status?: string; readonly input?: Record<string, unknown>; readonly content?: readonly { readonly type?: string; readonly text?: string }[]; readonly error?: { readonly message?: string } };
  readonly text?: string;
};

type Message = {
  readonly id?: string;
  readonly type?: string;
  readonly text?: string;
  readonly time?: { readonly created?: number; readonly completed?: number };
  readonly skills?: readonly { readonly name?: string }[];
  readonly content?: readonly ToolPart[];
  readonly tokens?: { readonly output?: number };
  readonly finish?: string;
  readonly error?: unknown;
};

/** Reads the newest turn of an opencode session (its last user prompt and the replies after it), in Claude Code terms. */
export class OpencodeTurnReader {
  private static readonly TOOL_NAMES: Readonly<Record<string, string>> = {
    bash: 'Bash', shell: 'Bash', edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', patch: 'Edit', read: 'Read',
    glob: 'Glob', grep: 'Grep', list: 'LS', skill: 'Skill', task: 'Agent', question: 'AskUserQuestion',
    todowrite: 'TodoWrite', webfetch: 'WebFetch', websearch: 'WebSearch',
  };
  private static readonly FINISHED = new Set(['completed', 'error']);

  /** The newest user prompt, or null when the session has none. */
  static latestPrompt(messages: readonly unknown[]): { readonly turnId: string; readonly text: string; readonly skills: readonly string[] } | null {
    const user = [...(messages as readonly Message[])].reverse().find((message) => message.type === 'user');
    if (!user) {
      return null;
    }
    return { turnId: user.id ?? String(user.time?.created ?? 0), text: user.text ?? '', skills: OpencodeTurnReader.skillsOf(user) };
  }

  static latestTurn(messages: readonly unknown[]): OpencodeTurn | null {
    const list = messages as readonly Message[];
    const start = list.map((message) => message.type).lastIndexOf('user');
    const user = list[start];
    if (!user) {
      return null;
    }
    const replies = list.slice(start + 1).filter((message) => message.type === 'assistant');
    const last = replies.at(-1);
    const startedAt = user.time?.created ?? 0;
    const endedAt = last?.time?.completed ?? last?.time?.created ?? startedAt;
    return {
      turnId: user.id ?? String(startedAt),
      prompt: user.text ?? '',
      skills: OpencodeTurnReader.skillsOf(user),
      calls: replies.flatMap((reply) => (reply.content ?? []).flatMap((part) => OpencodeTurnReader.call(part))),
      answer: (last?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim(),
      durationMs: Math.max(0, endedAt - startedAt),
      outputTokens: replies.reduce((sum, reply) => sum + (reply.tokens?.output ?? 0), 0),
      reason: last?.error ? 'error' : (last?.finish ?? 'stop'),
    };
  }

  /** The Claude Code tool name for an opencode tool. */
  static claudeName(name: string): string {
    return OpencodeTurnReader.TOOL_NAMES[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
  }

  private static call(part: ToolPart): OpencodeTurn['calls'] {
    const status = part.state?.status;
    if (part.type !== 'tool' || !part.name || !status || !OpencodeTurnReader.FINISHED.has(status)) {
      return [];
    }
    const tool = OpencodeTurnReader.claudeName(part.name);
    const raw = part.state?.input ?? {};
    const input: Record<string, unknown> = { ...raw };
    const filePath = raw['filePath'] ?? raw['path'];
    if (input['file_path'] === undefined && typeof filePath === 'string') {
      input['file_path'] = filePath;
    }
    if (tool === 'Skill' && input['skill'] === undefined && typeof raw['name'] === 'string') {
      input['skill'] = raw['name'];
    }
    if (tool === 'Agent' && input['subagent_type'] === undefined && typeof raw['agent'] === 'string') {
      input['subagent_type'] = raw['agent'];
    }
    const text = (part.state?.content ?? []).map((content) => (content.type === 'text' ? (content.text ?? '') : '')).join('\n');
    const isError = status === 'error';
    return [{ tool, input, resultText: isError && text === '' ? (part.state?.error?.message ?? '') : text, isError }];
  }

  private static skillsOf(user: Message): string[] {
    return (user.skills ?? []).map((skill) => skill.name).filter((name): name is string => !!name);
  }
}
