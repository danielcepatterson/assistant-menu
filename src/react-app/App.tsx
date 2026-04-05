// src/App.tsx

import "./App.css";

interface Tool {
	name: string;
	description: string;
	url: string;
	available: boolean;
}

const tools: Tool[] = [
	{
		name: "Auto Scheduler",
		description: "Automated scheduling assistant for managing your calendar",
		url: "https://auto-scheduler.danielcepatterson.workers.dev",
		available: true,
	},
	{
		name: "TCD Analyzer",
		description: "Trouble condition details report analysis",
		url: "https://tcd-analysis.danielcepatterson.workers.dev",
		available: true,
	},
	{
		name: "Maintenance Reporter 2",
		description: "Maintenance reporting and tracking tool",
		url: "https://maintenance-reporter2.danielcepatterson.workers.dev",
		available: true,
	},
];

function App() {
	return (
		<div className="menu-container">
			<header className="menu-header">
				<h1>🛠️ Assistant Tools</h1>
				<p className="subtitle">Your collection of productivity tools</p>
			</header>

			<nav className="tools-list">
				{tools.map((tool, index) => (
					<a
						key={index}
						href={tool.available ? tool.url : undefined}
						className={`tool-card ${!tool.available ? "disabled" : ""}`}
						target={tool.available ? "_blank" : undefined}
						rel="noopener noreferrer"
					>
						<div className="tool-content">
							<h2 className="tool-name">{tool.name}</h2>
							<p className="tool-description">{tool.description}</p>
						</div>
						<span className="tool-arrow">{tool.available ? "→" : "🔒"}</span>
					</a>
				))}
			</nav>

			<footer className="menu-footer">
				<p>Powered by Cloudflare Workers</p>
			</footer>
		</div>
	);
}

export default App;
