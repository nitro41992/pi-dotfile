export interface PlanStep {
	step: number;
	text: string;
	completed: boolean;
}

const SAFE_COMMANDS = [
	/^\s*(pwd|ls|find|rg|grep|git\s+(status|diff|log|show|branch|rev-parse|ls-files)|npm\s+(ls|outdated)|pnpm\s+(ls|outdated)|yarn\s+(list|outdated))\b/,
	/^\s*(node|python3?|ruby|perl)\s+-e\s+['"][\s\S]*['"]\s*$/,
];

const UNSAFE_SHELL_TOKENS = /\b(rm|mv|cp|mkdir|touch|chmod|chown|sudo|tee|curl|wget|npm\s+install|pnpm\s+install|yarn\s+add|git\s+(commit|push|pull|merge|rebase|checkout|switch|reset|clean|apply|am))\b|>|>>|\|\s*(sh|bash)\b/i;

export function isSafeCommand(command: string): boolean {
	if (!command.trim()) return false;
	if (UNSAFE_SHELL_TOKENS.test(command)) return false;
	return SAFE_COMMANDS.some((pattern) => pattern.test(command));
}

export function extractPlanSteps(text: string): PlanStep[] {
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex((line) => /^\s*(#{1,4}\s*)?(implementation\s+)?plan\s*:?\s*$/i.test(line));
	const source = start >= 0 ? lines.slice(start + 1) : lines;
	const steps: PlanStep[] = [];

	for (const line of source) {
		const match = line.match(/^\s*(?:[-*]\s*)?(\d+)[.)]\s+(.+?)\s*$/);
		if (!match) continue;
		const step = Number(match[1]);
		const raw = match[2].replace(/\s+/g, " ").trim();
		if (!raw || /^(approve|shall i|would you|do you want)/i.test(raw)) continue;
		steps.push({ step, text: raw, completed: false });
	}

	return steps;
}

export function extractDoneSteps(text: string): number[] {
	return Array.from(text.matchAll(/\[DONE:(\d+)\]/g)).map((match) => Number(match[1]));
}

export function markCompletedSteps(text: string, items: PlanStep[]): number {
	let count = 0;
	for (const step of extractDoneSteps(text)) {
		const item = items.find((candidate) => candidate.step === step);
		if (item && !item.completed) {
			item.completed = true;
			count++;
		}
	}
	return count;
}
