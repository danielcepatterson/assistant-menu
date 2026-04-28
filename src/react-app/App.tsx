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
	vacantDays: number;
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
	vacantDays: number;
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

const normalizeUnit = (value: string) => 
	value.trim().replace(/\s+/g, ' ').toLowerCase();

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

function buildCrossReference(vacancyRows: GenericRow[], workOrderRows: GenericRow[]) {
	const normalizedVacancy = normalizeRows(vacancyRows);
	const normalizedWorkOrders = normalizeRows(workOrderRows);

	console.log("Raw vacancy rows:", vacancyRows.slice(0, 3));
	console.log("Normalized vacancy:", normalizedVacancy.slice(0, 3));
	console.log("Raw work order rows:", workOrderRows.slice(0, 3));
	console.log("Normalized work orders:", normalizedWorkOrders.slice(0, 3));

	const parsedVacancies: ParsedVacancy[] = normalizedVacancy
		.map((row) => {
			const unitName = pickString(row, ["unitname", "unit", "property", "propertyname"]);
			const startRaw = pickFirst(row, ["vacancystartdate", "startdate", "vacancystart"]);
			const endRaw = pickFirst(row, ["vacancyenddate", "enddate", "vacancyend"]);
			const vacantDaysRaw = pickFirst(row, ["vacantdays", "vacant", "days"]);

			const windowStart = parseDateValue(startRaw);
			const windowEnd = parseDateValue(endRaw);
			const vacantDays = vacantDaysRaw ? Number(vacantDaysRaw) : 0;

			console.log("Vacancy parsing:", { unitName, startRaw, endRaw, windowStart, windowEnd, vacantDays });

			if (!unitName || !windowStart || !windowEnd) return null;

			return {
				unitName,
				windowStart,
				windowEnd,
				startText: formatDate(windowStart),
				endText: formatDate(windowEnd),
				vacantDays,
			};
		})
		.filter((item): item is ParsedVacancy => item !== null);

	const parsedWorkOrders: ParsedWorkOrder[] = normalizedWorkOrders
		.map((row) => {
			// Try multiple possible column names for cabin/unit number
			const unitName = pickString(row, [
				"cabin",
				"cabinnumber",
				"cabin",
				"unitname",
				"unit",
				"property",
				"propertyname",
				"rental",
				"rentalunit",
			]);
			
			if (!unitName) {
				console.log("Work order row with no unit name:", row);
				return null;
			}

			const orderId =
				pickString(row, ["workordernumber", "workorder", "wo", "id", "ordernumber", "number"]) ||
				"(no id)";

			const status = pickString(row, ["status", "workorderstatus", "wostatus"]);
			
			console.log("Work order parsing:", { unitName, orderId, status, allKeys: Object.keys(row) });
			
			// Don't filter by status for now - let's see all work orders
			// if (!isPossiblyActiveStatus(status)) return null;

			const dateRaw = pickFirst(row, [
				"workorderdate",
				"createddate",
				"opendate",
				"reporteddate",
				"date",
				"created",
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
		console.log("Looking for matches for unit:", vacancy.unitName, "normalized:", unitKey);
		
		const matches = parsedWorkOrders.filter((workOrder) => {
			const workOrderKey = normalizeUnit(workOrder.unitName);
			const unitMatch = workOrderKey === unitKey;
			
			if (vacancy.unitName.toLowerCase().includes("shore") || workOrder.unitName.toLowerCase().includes("shore")) {
				console.log("  SHORE TEST - Comparing:", vacancy.unitName, "("+unitKey+")", "with:", workOrder.unitName, "("+workOrderKey+")", "match:", unitMatch);
			}

			if (!unitMatch) return false;

			// If no date, include it
			if (!workOrder.date) {
				console.log("    -> Including (no date)");
				return true;
			}

			const orderTime = workOrder.date.getTime();
			const inWindow = (
				orderTime >= vacancy.windowStart.getTime() &&
				orderTime <= vacancy.windowEnd.getTime()
			);
			
			console.log("    -> Date check:", workOrder.dateText, "in window:", inWindow);
			return inWindow;
		});

		console.log("  Found", matches.length, "matches for", vacancy.unitName);

		return {
			unitName: vacancy.unitName,
			windowStart: vacancy.startText,
			windowEnd: vacancy.endText,
			vacantDays: vacancy.vacantDays,
			matchCount: matches.length,
			matchedOrders: matches.map((m) => m.orderId).join(", ") || "None",
			matchedStatuses: matches.map((m) => m.status).join(", ") || "None",
			matchedDates: matches.map((m) => m.dateText).join(", ") || "None",
		};
	});

	console.log("Parsed vacancies:", parsedVacancies);
	console.log("Parsed work orders:", parsedWorkOrders);
	console.log("Result rows:", resultRows);

	return {
		resultRows,
		vacancyCount: parsedVacancies.length,
		workOrderCount: parsedWorkOrders.length,
		debugVacancies: parsedVacancies.slice(0, 5),
		debugWorkOrders: parsedWorkOrders.slice(0, 5),
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

interface CalendarViewProps {
	vacancyRows: GenericRow[];
	workOrderRows: GenericRow[];
}

function CalendarView({ vacancyRows, workOrderRows }: CalendarViewProps) {
	// Get date range from all vacancy windows
	const normalizedVacancy = normalizeRows(vacancyRows);
	
	const vacanciesByUnit = new Map<string, Array<{ start: Date; end: Date; days: number }>>();
	const workOrdersByUnit = new Map<string, string[]>();
	
	// Parse vacancies
	normalizedVacancy.forEach((row) => {
		const unitName = pickString(row, ["unitname", "unit", "property", "propertyname"]);
		const startRaw = pickFirst(row, ["vacancystartdate", "startdate", "vacancystart"]);
		const endRaw = pickFirst(row, ["vacancyenddate", "enddate", "vacancyend"]);
		const daysRaw = pickFirst(row, ["vacantdays", "vacant", "days"]);
		
		const start = parseDateValue(startRaw);
		const end = parseDateValue(endRaw);
		const days = daysRaw ? Number(daysRaw) : 0;
		
		if (!unitName || !start || !end) return;
		
		if (!vacanciesByUnit.has(unitName)) {
			vacanciesByUnit.set(unitName, []);
		}
		vacanciesByUnit.get(unitName)!.push({ start, end, days });
	});
	
	// Parse work orders
	const normalizedWorkOrders = normalizeRows(workOrderRows);
	normalizedWorkOrders.forEach((row) => {
		const unitName = pickString(row, [
			"cabin",
			"cabinnumber",
			"unitname",
			"unit",
			"property",
			"propertyname",
			"rental",
		]);
		const orderId = pickString(row, ["workordernumber", "workorder", "wo", "id", "ordernumber"]) || "(no id)";
		
		if (!unitName) return;
		
		const normalizedUnit = normalizeUnit(unitName);
		
		// Find matching unit in vacancies
		for (const [vacUnit] of vacanciesByUnit.entries()) {
			if (normalizeUnit(vacUnit) === normalizedUnit) {
				if (!workOrdersByUnit.has(vacUnit)) {
					workOrdersByUnit.set(vacUnit, []);
				}
				workOrdersByUnit.get(vacUnit)!.push(orderId);
				break;
			}
		}
	});
	
	// Get all dates
	let minDate: Date | null = null;
	let maxDate: Date | null = null;
	
	for (const windows of vacanciesByUnit.values()) {
		for (const window of windows) {
			if (!minDate || window.start < minDate) minDate = window.start;
			if (!maxDate || window.end > maxDate) maxDate = window.end;
		}
	}
	
	if (!minDate || !maxDate) {
		return <p>No vacancy data to display</p>;
	}
	
	// Generate date headers (days)
	const dateHeaders: Date[] = [];
	const current = new Date(minDate);
	while (current <= maxDate) {
		dateHeaders.push(new Date(current));
		current.setDate(current.getDate() + 1);
	}
	
	// Sort units alphabetically
	const sortedUnits = Array.from(vacanciesByUnit.keys()).sort((a, b) => a.localeCompare(b));
	
	return (
		<div className="calendar-container">
			<div className="calendar-scroll">
				<table className="calendar-table">
					<thead>
						<tr>
							<th className="unit-header">Unit</th>
							{dateHeaders.map((date, i) => (
								<th key={i} className="date-header">
									<div>{date.getMonth() + 1}/{date.getDate()}</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{sortedUnits.map((unit) => {
							const windows = vacanciesByUnit.get(unit)!;
							const workOrders = workOrdersByUnit.get(unit) || [];
							const hasOnlyOneShortWindow = windows.length === 1 && windows[0].days < 3;
							
							// Find earliest window to place work orders
							const earliestWindow = windows.reduce((earliest, current) => 
								current.start < earliest.start ? current : earliest
							);
							
							return (
								<tr key={unit}>
									<td className="unit-cell">{unit}</td>
									{dateHeaders.map((date, i) => {
										// Check if this date is in any vacancy window
										const inWindow = windows.find(w => 
											date >= w.start && date <= w.end
										);
										
										// Check if this is the first day of the earliest window
										const isFirstDayOfEarliest = 
											earliestWindow && 
											date.getTime() === earliestWindow.start.getTime();
										
										return (
											<td 
												key={i} 
												className={`calendar-cell ${inWindow ? 'vacant' : ''} ${hasOnlyOneShortWindow && inWindow ? 'alert' : ''}`}
											>
												{inWindow && isFirstDayOfEarliest && workOrders.length > 0 ? (
													<span className="work-order-label">
														{workOrders.join(", ")}
													</span>
												) : null}
											</td>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
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
	const [sortBy, setSortBy] = useState<"unitName" | "windowStart" | "vacantDays">("unitName");
	const [viewMode, setViewMode] = useState<"table" | "calendar">("table");

	const analysis = useMemo(() => {
		if (!vacancyRows.length || !workOrderRows.length || !showResults) return null;
		return buildCrossReference(vacancyRows, workOrderRows);
	}, [vacancyRows, workOrderRows, showResults]);

	const sortedResults = useMemo(() => {
		if (!analysis) return [];
		const sorted = [...analysis.resultRows];
		
		if (sortBy === "unitName") {
			sorted.sort((a, b) => a.unitName.localeCompare(b.unitName));
		} else if (sortBy === "windowStart") {
			sorted.sort((a, b) => {
				const dateA = new Date(a.windowStart);
				const dateB = new Date(b.windowStart);
				return dateA.getTime() - dateB.getTime();
			});
		} else if (sortBy === "vacantDays") {
			sorted.sort((a, b) => b.vacantDays - a.vacantDays);
		}
		
		return sorted;
	}, [analysis, sortBy]);

	const rowsWithoutMatch = analysis?.resultRows.filter((row) => row.matchCount === 0).length ?? 0;
	const canRunAnalysis = vacancyRows.length > 0 && workOrderRows.length > 0;

	const handlePrint = () => {
		window.print();
	};

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
						<div className="results-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
							<div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
								<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
									<button
										onClick={() => setViewMode("table")}
										className={viewMode === "table" ? "view-button active" : "view-button"}
									>
										📊 Table
									</button>
									<button
										onClick={() => setViewMode("calendar")}
										className={viewMode === "calendar" ? "view-button active" : "view-button"}
									>
										📅 Calendar
									</button>
								</div>
								{viewMode === "table" && (
									<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
										<label style={{ fontSize: "0.9rem" }}>Sort by:</label>
										<select 
											value={sortBy} 
											onChange={(e) => setSortBy(e.target.value as "unitName" | "windowStart" | "vacantDays")}
											style={{ padding: "0.5rem", borderRadius: "6px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "inherit", cursor: "pointer" }}
										>
											<option value="unitName">Unit Name (A-Z)</option>
											<option value="windowStart">Window Start Date</option>
											<option value="vacantDays">Vacant Days (High to Low)</option>
										</select>
									</div>
								)}
							</div>
							<button onClick={handlePrint} className="print-button">
								🖨️ Print Results
							</button>
						</div>

						{viewMode === "table" ? (
							<>
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
												<th>Window Start</th>
												<th>Window End</th>
											<th>Vacant Days</th>
											<th>Work Orders</th>
										</tr>
									</thead>
									<tbody>
										{sortedResults.map((row, index) => (
											<tr key={`${row.unitName}-${index}`}>
												<td>{row.unitName}</td>
												<td>{row.windowStart}</td>
												<td>{row.windowEnd}</td>
												<td>{row.vacantDays}</td>
													<td>{row.matchedOrders}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</>
						) : (
							<CalendarView 
								vacancyRows={vacancyRows} 
								workOrderRows={workOrderRows}
							/>
						)}
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
