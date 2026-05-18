import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";

const TONIC_LOGO = [
	"▄▄▄█████▓ ▒█████   ███▄    █  ██▓ ▄████▄",
	"▓  ██▒ ▓▒▒██▒  ██▒ ██ ▀█   █ ▓██▒▒██▀ ▀█",
	"▒ ▓██░ ▒░▒██░  ██▒▓██  ▀█ ██▒▒██▒▒▓█    ▄",
	"░ ▓██▓ ░ ▒██   ██░▓██▒  ▐▌██▒░██░▒▓▓▄ ▄██▒",
	"  ▒██▒ ░ ░ ████▓▒░▒██░   ▓██░░██░▒ ▓███▀ ░",
	"  ▒ ░░   ░ ▒░▒░▒░ ░ ▒░   ▒ ▒ ░▓  ░ ░▒ ▒  ░",
	"    ░      ░ ▒ ▒░ ░ ░░   ░ ▒░ ▒ ░  ░  ▒",
	"  ░      ░ ░ ░ ▒     ░   ░ ░  ▒ ░░",
	"             ░ ░           ░  ░  ░ ░",
	"                                  ░",
];

function renderTonicHeader(theme: Theme): string[] {
	return [
		...TONIC_LOGO.map((line) => theme.bold(theme.fg("accent", line))),
		theme.fg("dim", `TONIC v${VERSION}`),
		"",
		theme.fg("muted", "Type / for commands · ! for bash · Ctrl+C to interrupt"),
		theme.fg("dim", "Persistent custom header from dotfiles/pi/extensions/tonic-header"),
	];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setHeader((_tui, theme) => ({
			render(_width: number): string[] {
				return renderTonicHeader(theme);
			},
			invalidate() {},
		}));
	});

	pi.registerCommand("builtin-header", {
		description: "Restore the built-in Pi startup header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});

	pi.registerCommand("tonic-header", {
		description: "Restore the TONIC startup header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader((_tui, theme) => ({
				render(_width: number): string[] {
					return renderTonicHeader(theme);
				},
				invalidate() {},
			}));
			ctx.ui.notify("TONIC header restored", "info");
		},
	});
}
