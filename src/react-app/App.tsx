import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import "./App.css";

interface ExternalTool {
	name: string;
	description: string;
	url: string;
}

interface ParsedVacancy {
	unitName: string;
	windowStart: Date;
	windowEnd: Date;
	startText: string;
	endText: string;
}

interface ParsedWorkOrder {
	unitName: string;
	orderId: string;
	status: string;
	date: Date | null;
	dateText: string;
}

interface CrossRefRow {
	unitName: string;
	windowStart: string;
	windowEnd: string;
	matchCount: number;
	matchedOrders: string;
	matchedStatuses: string;
	matchedDates: string;
}

type GenericRow = Record<string, unknown>;

const externalTools: ExternalTool[] = [
	{
		name: "Auto Scheduler",
		description: "Automated scheduling assistant for managing your calendar",
		url: "https://auto-scheduler.danielcepatterson.workers.dev",
	},
	{
		name: "TCD Analyzer",
		description: "Trouble condition details report analysis",
		url: "https://tcd-analysis.danielcepatterson.workers.dev",
	},
	{
		name: "Maintenance Reporter 2",
		description: "Maintenance reporting and tracking tool",
		url: "https://maintenance-reporter2.danielcepatterson.workers.dev",
	},
];

const normalizeKey = (value: string) =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeUnit = (value: string) => value.trim().toLowerCase();

const formatDate = (date: Date) =>
	`${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;

function parseDateValue(value: unknown): Date | null {
	if (value == null || value === "") return null;

	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value;
	}

	if (typeof value === "number") {
		const excelEpoch = Date.UTC(1899, 11, 30);
		const parsed = new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return null;

		const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
		const match = trimmed.match(slashDate);
		if (match) {
			const month = Number(match[1]) - 1;
			const day = Number(match[2]);
			const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
			const parsed = new Date(year, month, day);
			return Number.isNaN(parsed.getTime()) ? null : parsed;
		}

		const native = new Date(trimmed);
		if (!Number.isNaN(native.getTime())) return native;
	}

	return null;
}

function normalizeRows(rows: GenericRow[]): Record<string, unknown>[] {
	return rows.map((row) => {
		const normalized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			normalized[normalizeKey(key)] = value;
		}
		return normalized;
	});
}

function pickFirst(row: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
			return row[key];
		}
	}
	return undefined;
}

function pickString(row: Record<string, unknown>, keys: string[]) {
	const raw = pickFirst(row, keys);
	if (raw == null) return "";
	return String(raw).trim();
}

async function parseReport(file: File): Promise<GenericRow[]> {
	const buffer = await file.arrayBuffer();
	
	// Check if it's HTML (common for .xls exports that are actually HTML)
	const decoder = new TextDecoder();
	const text = decoder.decode(buffer.slice(0, 1000));
	
	if (text.includes('<html') || text.includes('<table')) {
		// Parse as HTML table
		const fullText = decoder.decode(buffer);
		const parser = new DOMParser();
		const doc = parser.parseFromString(fullText, 'text/html');
		const tables = doc.querySelectorAll('table');
		
		if (tables.length === 0) return [];
		
		// Find table with most rows (skip header tables)
		let bestTable = tables[0];
		let maxRows = 0;
		tables.forEach(table => {
			const rows = table.querySelectorAll('tbody tr');
			if (rows.length > maxRows) {
				maxRows = rows.length;
				bestTable = table;
			}
		});
		
		const headerRow = bestTable.querySelector('thead tr');
		if (!headerRow) return [];
		
		const headers: string[] = [];
		headerRow.querySelectorAll('th').forEach(th => {
			headers.push(th.textContent?.trim() || '');
		});
		
		const result: GenericRow[] = [];
		const bodyRows = bestTable.querySelectorAll('tbody tr');
		bodyRows.forEach(tr => {
			const cells = tr.querySelectorAll('td');
			if (cells.length === 0) return;
			
			const row: GenericRow = {};
			cells.forEach((td, i) => {
				if (headers[i]) {
					row[headers[i]] = td.textContent?.trim() || '';
				}
			});
			result.push(row);
		});
		
		return result;
	}
	
	// Otherwise parse as Excel
	const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName) return [];

	const sheet = workbook.Sheets[firstSheetName];
	const parsed = XLSX.utils.sheet_to_json<GenericRow>(sheet, {
		defval: "",
		raw: false,
	});

	return parsed;
}

function isPossiblyActiveStatus(status: string) {
	if (!status) return true;
	const value = status.toLowerCase();
	if (value.includes("closed") || value.includes("complete") || value.includes("cancel")) {
		return false;
	}
	return true;
}

function buildCrossReference(vacancyRows: GenericRow[], workOrderRows: GenericRow[]) {
	const normalizedVacancy = normalizeRows(vacancyRows);
	const normalizedWorkOrders = normalizeRows(workOrderRows);

	const parsedVacancies: ParsedVacancy[] = normalizedVacancy
		.map((row) => {
			const unitName = pickString(row, ["unitname", "unit", "property", "propertyname"]);
			const startRaw = pickFirst(row, ["vacancystartdate", "startdate", "vacancystart"]);
			const endRaw = pickFirst(row, ["vacancyenddate", "enddate", "vacancyend"]);

			const windowStart = parseDateValue(startRaw);
			const windowEnd = parseDateValue(endRaw);

			if (!unitName || !windowStart || !windowEnd) return null;

			return {
				unitName,
				windowStart,
				windowEnd,
				startText: formatDate(windowStart),
				endText: formatDate(windowEnd),
			};
		})
		.filter((item): item is ParsedVacancy => item !== null);

	const parsedWorkOrders: ParsedWorkOrder[] = normalizedWorkOrders
		.map((row) => {
			const unitName = pickString(row, [
				"unitname",
				"unit",
				"property",
				"propertyname",
				"rental",
			]);
			if (!unitName) return null;

			const orderId =
				pickString(row, ["workordernumber", "workorder", "wo", "id", "ordernumber"]) ||
				"(no id)";

			const status = pickString(row, ["status", "workorderstatus", "wostatus"]);
			if (!isPossiblyActiveStatus(status)) return null;

			const dateRaw = pickFirst(row, [
				"workorderdate",
				"createddate",
				"opendate",
				"reporteddate",
				"date",
			]);
			const date = parseDateValue(dateRaw);

			return {
				unitName,
				orderId,
				status: status || "(no status)",
				date,
				dateText: date ? formatDate(date) : "(no date)",
			};
		})
		.filter((item): item is ParsedWorkOrder => item !== null);

	const resultRows: CrossRefRow[] = parsedVacancies.map((vacancy) => {
		const unitKey = normalizeUnit(vacancy.unitName);
		const matches = parsedWorkOrders.filter((workOrder) => {
			if (normalizeUnit(workOrder.unitName) !== unitKey) return false;

			if (!workOrder.date) return true;

			const orderTime = workOrder.date.getTime();
			return (
				orderTime >= vacancy.windowStart.getTime() &&
				orderTime <= vacancy.windowEnd.getTime()
			);
		});

		return {
			unitName: vacancy.unitName,
			windowStart: vacancy.startText,
			windowEnd: vacancy.endText,
			matchCount: matches.length,
			matchedOrders: matches.map((m) => m.orderId).join(", ") || "None",
			matchedStatuses: matches.map((m) => m.status).join(", ") || "None",
			matchedDates: matches.map((m) => m.dateText).join(", ") || "None",
		};
	});

	return {
		resultRows,
		vacancyCount: parsedVacancies.length,
		workOrderCount: parsedWorkOrders.length,
	};
}

interface DropZoneProps {
	title: string;
	helpText: string;
	fileName: string;
	rowCount: number;
	onFileSelected: (file: File) => void;
}

function DropZone({ title, helpText, fileName, rowCount, onFileSelected }: DropZoneProps) {
	const [isDragging, setIsDragging] = useState(false);

	return (
		<div
			className={`drop-zone ${isDragging ? "dragging" : ""}`}
			onDragOver={(event) => {
				event.preventDefault();
				setIsDragging(true);
			}}
			onDragLeave={() => setIsDragging(false)}
			onDrop={(event) => {
				event.preventDefault();
				setIsDragging(false);
				const file = event.dataTransfer.files?.[0];
				if (file) onFileSelected(file);
			}}
		>
			<h3>{title}</h3>
			<p>{helpText}</p>
			<label className="upload-button">
				Choose file
				<input
					type="file"
					accept=".csv,.xls,.xlsx"
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) onFileSelected(file);
					}}
				/>
			</label>
			<div className="file-name">{fileName || "No file selected"}</div>
			{rowCount > 0 ? (
				<div className="row-count">✓ {rowCount} rows parsed</div>
			) : null}
		</div>
	);
}

function App() {
	const [view, setView] = useState<"menu" | "vacancyAnalyzer">("menu");
	const [vacancyFileName, setVacancyFileName] = useState("");
	const [workOrderFileName, setWorkOrderFileName] = useState("");
	const [vacancyRows, setVacancyRows] = useState<GenericRow[]>([]);
	const [workOrderRows, setWorkOrderRows] = useState<GenericRow[]>([]);
	const [error, setError] = useState("");
	const [showResults, setShowResults] = useState(false);

	const analysis = useMemo(() => {
		if (!vacancyRows.length || !workOrderRows.length || !showResults) return null;
		return buildCrossReference(vacancyRows, workOrderRows);
	}, [vacancyRows, workOrderRows, showResults]);

	const rowsWithoutMatch = analysis?.resultRows.filter((row) => row.matchCount === 0).length ?? 0;
	const canRunAnalysis = vacancyRows.length > 0 && workOrderRows.length > 0;

	const handleVacancyFile = async (file: File) => {
		setError("");
		setShowResults(false);
		try {
			const parsed = await parseReport(file);
			console.log("Vacancy file parsed:", parsed.length, "rows");
			console.log("First row:", parsed[0]);
			setVacancyRows(parsed);
			setVacancyFileName(file.name);
		} catch (err) {
			console.error("Error parsing vacancy file:", err);
			setError("Could not read vacancy report. Please use CSV/XLS/XLSX.");
		}
	};

	const handleWorkOrderFile = async (file: File) => {
		setError("");
		setShowResults(false);
		try {
			const parsed = await parseReport(file);
			console.log("Work order file parsed:", parsed.length, "rows");
			console.log("First row:", parsed[0]);
			setWorkOrderRows(parsed);
			setWorkOrderFileName(file.name);
		} catch (err) {
			console.error("Error parsing work order file:", err);
			setError("Could not read work order report. Please use CSV/XLS/XLSX.");
		}
	};

	if (view === "vacancyAnalyzer") {
		return (
			<div className="app-shell">
				<header className="menu-header analyzer-header">
					<h1>📊 Vacancy vs Active Work Orders</h1>
					<p className="subtitle">
						Work Window = Vacancy Start Date through Vacancy End Date (inclusive).
					</p>
					<button className="back-button" onClick={() => setView("menu")}>
						← Back to Tool Menu
					</button>
				</header>

				<section className="drop-grid">
					<DropZone
						title="Vacancy Report"
						helpText="Drop CSV/XLS/XLSX here"
						fileName={vacancyFileName}
						rowCount={vacancyRows.length}
						onFileSelected={handleVacancyFile}
					/>
					<DropZone
						title="Active Work Order Report"
						helpText="Drop CSV/XLS/XLSX here"
						fileName={workOrderFileName}
						rowCount={workOrderRows.length}
						onFileSelected={handleWorkOrderFile}
					/>
				</section>

				{error ? <p className="error-text">{error}</p> : null}

				<div className="action-row">
					<button
						className="analyze-button"
						onClick={() => setShowResults(true)}
						disabled={!canRunAnalysis}
					>
						{canRunAnalysis ? "Run Analysis" : "Upload both reports to continue"}
					</button>
					{canRunAnalysis && !showResults ? (
						<p className="ready-text">✓ Ready to analyze</p>
					) : null}
				</div>

				{analysis ? (
					<section className="results-panel">
						<div className="summary-grid">
							<div className="summary-card">
								<span>Vacancy Windows</span>
								<strong>{analysis.vacancyCount}</strong>
							</div>
							<div className="summary-card">
								<span>Active Work Orders Parsed</span>
								<strong>{analysis.workOrderCount}</strong>
							</div>
							<div className="summary-card">
								<span>Windows With No Match</span>
								<strong>{rowsWithoutMatch}</strong>
							</div>
						</div>

						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Unit Name</th>
										<th>Work Window Start</th>
										<th>Work Window End</th>
										<th>Match Count</th>
										<th>Matched Work Order IDs</th>
										<th>Matched Statuses</th>
										<th>Matched Dates</th>
									</tr>
								</thead>
								<tbody>
									{analysis.resultRows.map((row, index) => (
										<tr key={`${row.unitName}-${index}`}>
											<td>{row.unitName}</td>
											<td>{row.windowStart}</td>
											<td>{row.windowEnd}</td>
											<td>{row.matchCount}</td>
											<td>{row.matchedOrders}</td>
											<td>{row.matchedStatuses}</td>
											<td>{row.matchedDates}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
				) : null}
			</div>
		);
	}

	return (
		<div className="menu-container">
			<header className="menu-header">
				<h1>🛠️ Assistant Tools</h1>
				<p className="subtitle">Your collection of productivity tools</p>
			</header>

			<nav className="tools-list">
				{externalTools.map((tool) => (
					<a
						key={tool.name}
						href={tool.url}
						className="tool-card"
						target="_blank"
						rel="noopener noreferrer"
					>
						<div className="tool-content">
							<h2 className="tool-name">{tool.name}</h2>
							<p className="tool-description">{tool.description}</p>
						</div>
						<span className="tool-arrow">→</span>
					</a>
				))}

				<button className="tool-card tool-card-button" onClick={() => setView("vacancyAnalyzer")}>
					<div className="tool-content">
						<h2 className="tool-name">Vacancy Work Window Analyzer</h2>
						<p className="tool-description">
							Drop vacancy + active work order reports and cross-reference by window.
						</p>
					</div>
					<span className="tool-arrow">→</span>
				</button>
			</nav>

			<footer className="menu-footer">
				<p>Powered by Cloudflare Workers</p>
			</footer>
		</div>
	);
}

export default App;
