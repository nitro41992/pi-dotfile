/**
 * Codex/Claude-style Plan Mode for pi.
 *
 * Flow:
 * 1. `/plan` enables read-only planning mode; `/plan <request>` also sends the request.
 * 2. The agent may read/search/ask questions, then must produce a numbered `Plan:`.
 * 3. The user chooses Approve, Comment, or Deny.
 * 4. Approve asks the agent to seed the installed `todo` tool, then execute with normal tools restored.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { EMPTY_STATE } from "@juicesharp/rpiv-todo/state/state.js";
import { commitState } from "@juicesharp/rpiv-todo/state/store.js";
import { extractPlanSteps, isSafeCommand, markCompletedSteps, type PlanStep } from "./utils.js";


const READ_ONLY_TOOL_CANDIDATES = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"web_search",
	"web_fetch",
	"questionnaire",
	"ask_user_question",
];
const MUTATING_TOOLS = new Set(["edit", "write"]);

// In plan mode, prefer raw web_search results: the summarize/fetch path has
// been observed to return `fetch failed` while the same query succeeds with
// summarize=false.

function isAssistantMessage(message: AgentMessage | null | undefined): message is AssistantMessage {
	return message?.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getLastAssistantMessage(event: { message?: unknown; messages?: unknown[] }): AssistantMessage | undefined {
	if (isAssistantMessage(event.message as AgentMessage | null | undefined)) return event.message as AssistantMessage;
	const messages = Array.isArray(event.messages) ? event.messages : [];
	return messages.slice().reverse().find((message): message is AssistantMessage => isAssistantMessage(message as AgentMessage));
}

type PlanDecision = { action: "approve" } | { action: "comment"; feedback: string } | { action: "deny" } | { action: "cancel" };

async function askPlanDecision(ctx: ExtensionContext): Promise<PlanDecision> {
	return ctx.ui.custom<PlanDecision>((tui, theme, _keybindings, done) => {
		let selected = 0;
		let inputMode = false;
		let cachedLines: string[] | undefined;
		const options = [
			{ label: "Approve", description: "Accept the plan and start implementation." },
			{ label: "Deny", description: "Reject the plan and leave plan mode." },
			{ label: "Comment", description: "Type feedback or requested changes for the agent." },
		];

		const editorTheme: EditorTheme = {
			borderColor: (s) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			},
		};
		const editor = new Editor(tui, editorTheme);

		function refresh(): void {
			cachedLines = undefined;
			tui.requestRender();
		}

		editor.onSubmit = (value) => {
			const feedback = value.trim();
			if (feedback) done({ action: "comment", feedback });
		};

		function handleInput(data: string): void {
			if (inputMode) {
				if (matchesKey(data, Key.escape)) {
					inputMode = false;
					editor.setText("");
					refresh();
					return;
				}
				editor.handleInput(data);
				refresh();
				return;
			}

			if (matchesKey(data, Key.up)) {
				selected = Math.max(0, selected - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				selected = Math.min(options.length - 1, selected + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				done({ action: "cancel" });
				return;
			}
			if (matchesKey(data, Key.enter)) {
				if (selected === 0) done({ action: "approve" });
				else if (selected === 1) done({ action: "deny" });
				else {
					inputMode = true;
					refresh();
				}
			}
		}

		function render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (s: string) => lines.push(truncateToWidth(s, width));

			add(theme.fg("accent", "─".repeat(width)));
			add(theme.fg("accent", theme.bold(" Plan ready. What next?")));
			lines.push("");

			if (inputMode) {
				add(theme.fg("text", " Comment on the plan"));
				add(theme.fg("muted", " Type feedback or requested changes to send to the agent:"));
				lines.push("");
				for (const line of editor.render(width - 2)) add(` ${line}`);
				lines.push("");
				add(theme.fg("dim", " Enter to submit comment • Esc to return to options"));
			} else {
				for (let i = 0; i < options.length; i++) {
					const option = options[i];
					const prefix = i === selected ? theme.fg("accent", "> ") : "  ";
					const color = i === selected ? "accent" : "text";
					add(prefix + theme.fg(color, `${i + 1}. ${option.label}`));
					add(`     ${theme.fg("muted", option.description)}`);
				}
				lines.push("");
				add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
			}

			add(theme.fg("accent", "─".repeat(width)));
			cachedLines = lines;
			return lines;
		}

		return { render, handleInput, invalidate: () => (cachedLines = undefined) };
	});
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let planSteps: PlanStep[] = [];
	let previousTools: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read/search only until approval)",
		type: "boolean",
		default: false,
	});

	function persistState(): void {
		pi.appendEntry("plan-mode", { enabled: planModeEnabled, executing: executionMode, steps: planSteps, previousTools });
	}

	function updateStatus(ctx: ExtensionContext): void {
		// The installed todo extension is the single source of truth for task UI.
		// Keep plan-mode to a compact mode indicator only: no checklist, no task count.
		ctx.ui.setWidget("plan-mode-todos", undefined);

		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	function toolNames(tools: Array<string | { name: string }>): string[] {
		return tools.map((tool) => (typeof tool === "string" ? tool : tool.name));
	}

	function setReadOnlyTools(): void {
		previousTools = toolNames(pi.getActiveTools() as Array<string | { name: string }>);
		const allTools = new Set(toolNames(pi.getAllTools() as Array<string | { name: string }>));
		const activeTools = new Set(previousTools ?? []);
		const readOnlyTools = Array.from(
			new Set([
				...READ_ONLY_TOOL_CANDIDATES,
				...Array.from(activeTools).filter((tool) => /^(web|search|fetch|questionnaire|ask_user_question|mcp)/i.test(tool)),
			]),
		).filter((tool) => allTools.has(tool));
		pi.setActiveTools(readOnlyTools);
	}

	function restoreTools(): void {
		if (previousTools && previousTools.length > 0) pi.setActiveTools(previousTools);
		previousTools = undefined;
	}

	function enablePlanMode(ctx: ExtensionContext): void {
		if (!planModeEnabled) setReadOnlyTools();
		planModeEnabled = true;
		executionMode = false;
		planSteps = [];
		ctx.ui.notify("Plan mode enabled: read/search only until you approve a plan.", "info");
		updateStatus(ctx);
		persistState();
	}

	function exitPlanMode(ctx: ExtensionContext, message = "Plan mode exited."): void {
		planModeEnabled = false;
		executionMode = false;
		planSteps = [];
		restoreTools();
		ctx.ui.notify(message, "info");
		updateStatus(ctx);
		persistState();
	}

	function approvePlan(ctx: ExtensionContext): void {
		planModeEnabled = false;
		executionMode = planSteps.length > 0;
		restoreTools();

		if (planSteps.length > 0) {
			ctx.ui.notify(`Plan approved. The agent will create ${planSteps.length} todo task(s) before implementation.`, "info");
		}

		updateStatus(ctx);
		persistState();
		pi.sendUserMessage(
			planSteps.length > 0
				? `Plan approved. First create todos in the installed todo extension by calling the todo tool once per approved plan step with action=\"create\", subject=<step text>, description=\"Approved plan step from /plan\". Then execute the approved plan exactly as written. Start with step 1: ${planSteps[0].text}\n\nApproved plan steps:\n${planSteps.map((step) => `${step.step}. ${step.text}`).join("\n")}\n\nAfter completing each step, include [DONE:n] for that step number.`
				: "Plan approved. Execute the plan exactly as written.",
			{ deliverAs: "followUp" },
		);
	}

	pi.registerCommand("plan", {
		description: "Enable plan mode; optionally pass the planning request inline",
		handler: async (args, ctx) => {
			enablePlanMode(ctx);
			if (args.trim()) pi.sendUserMessage(args.trim());
		},
	});

	pi.registerCommand("exit-plan", {
		description: "Exit plan mode without executing the plan",
		handler: async (_args, ctx) => exitPlanMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return undefined;
		if (MUTATING_TOOLS.has(event.toolName)) {
			return { block: true, reason: `Plan mode is read-only. Tool '${event.toolName}' is blocked until the plan is approved.` };
		}
		if (event.toolName === "bash") {
			const command = String(event.input.command ?? "");
			if (!isSafeCommand(command)) {
				return { block: true, reason: `Plan mode allows read-only shell commands only. Blocked command: ${command}` };
			}
		}
		if (event.toolName === "web_search" && event.input.summarize === true) {
			return { block: true, reason: "Plan mode defaults web_search to summarize=false because the summarization/fetch path can fail; retry with summarize:false." };
		}
		return undefined;
	});

	pi.on("context", async (event) => {
		if (planModeEnabled) return undefined;
		return {
			messages: event.messages.filter((message) => {
				const msg = message as AgentMessage & { customType?: string };
				return msg.customType !== "plan-mode-context";
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode. Think deeply, research safely, and do not modify state before approval.

Allowed before approval:
- Read files and inspect the repository.
- Search the web when useful. Prefer web_search with summarize=false by default; if a search fails with \`fetch failed\`, retry without summarization before concluding web search is unavailable.
- Ask clarifying questions when requirements are ambiguous.
- Run only read-only shell commands.

Blocked before approval:
- edit/write tools and any file modification.
- state-changing shell commands, installs, git mutations, network command execution, or destructive operations.

When ready, produce a concise numbered plan under an exact "Plan:" heading. Include files/areas to change, risks, and verification. End by waiting for user approval, comments, or denial.`,
					display: false,
				},
			};
		}

		if (executionMode && planSteps.length > 0) {
			const remaining = planSteps.filter((step) => !step.completed).map((step) => `${step.step}. ${step.text}`).join("\n");
			return {
				message: {
					customType: "plan-mode-execution-context",
					content: `[EXECUTING APPROVED PLAN]
Execute only the approved plan. Do not silently add scope.

Remaining steps:
${remaining}

After completing a step, include [DONE:n] in your response. If the plan is wrong or impossible, stop and ask to return to plan mode.`,
					display: false,
				},
			};
		}

		return undefined;
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || planSteps.length === 0 || !isAssistantMessage(event.message)) return;
		if (markCompletedSteps(getTextContent(event.message), planSteps) > 0) {
			updateStatus(ctx);
			persistState();
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && planSteps.length > 0 && planSteps.every((step) => step.completed)) {
			// Clear the todo overlay once an approved plan is fully complete.
			// The todo extension is the source of truth for task UI; this removes
			// completed plan tasks instead of leaving a stale 8/8 list on screen.
			commitState({ tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId });
			ctx.ui.setWidget("rpiv-todos", undefined);
			pi.appendEntry("rpiv-todo-clear", { reason: "plan-mode-complete" });
			pi.sendMessage({ customType: "plan-mode-complete", content: "**Approved plan complete.** ✓", display: true });
			executionMode = false;
			planSteps = [];
			updateStatus(ctx);
			persistState();
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		const message = getLastAssistantMessage(event);
		if (!message) return;

		const text = getTextContent(message);
		planSteps = extractPlanSteps(text);
		persistState();

		if (planSteps.length === 0) return;

		const decision = await askPlanDecision(ctx);
		if (decision.action === "approve") {
			approvePlan(ctx);
		} else if (decision.action === "comment") {
			pi.sendUserMessage(`Revise the plan with this feedback. Do not implement yet.\n\n${decision.feedback}`);
		} else if (decision.action === "deny") {
			exitPlanMode(ctx, "Plan denied. No changes made.");
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) planModeEnabled = true;

		const entries = ctx.sessionManager.getEntries();
		const todoWasCleared = entries.some(
			(entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "rpiv-todo-clear",
		);
		if (todoWasCleared) {
			commitState({ tasks: [...EMPTY_STATE.tasks], nextId: EMPTY_STATE.nextId });
			ctx.ui.setWidget("rpiv-todos", undefined);
		}

		const state = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "plan-mode")
			.pop() as { data?: { enabled?: boolean; executing?: boolean; steps?: PlanStep[]; previousTools?: string[] } } | undefined;

		if (state?.data) {
			planModeEnabled = state.data.enabled ?? planModeEnabled;
			executionMode = state.data.executing ?? false;
			planSteps = state.data.steps ?? [];
			previousTools = state.data.previousTools;
		}

		if (planModeEnabled) setReadOnlyTools();
		updateStatus(ctx);
	});
}
