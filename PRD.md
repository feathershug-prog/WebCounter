PRODUCT REQUIREMENTS DOCUMENT (PRD)
Project Title: SKU Management Web Application
Version: 1.0
Prepared By: Senior Software Developer
Date: March 2026

---

1. OVERVIEW
   The SKU Management Web Application is a browser-based system built using HTML, CSS, and JavaScript, with a Node.js backend. It is designed to manage SKU operations, production tracking, and analytics within a factory or warehouse environment.

The application will include multiple modules such as Dashboard, Manager Setup, SKU Master, History, Factory Dashboard, Production Pivot, and Settings. Data persistence will be handled using a structured JSON file (data.json), with automatic backup support.

---

2. OBJECTIVES

* Provide an intuitive UI for managing SKU production
* Enable real-time calculation of production metrics
* Maintain structured historical records
* Provide analytical insights using charts and tables
* Ensure data persistence and automatic backup
* Implement role-based access for settings

---

3. TECH STACK
   Frontend: HTML, CSS, JavaScript (Need only Index.html write all code in this file. No need for separate CSS and JS files)
   Backend: Node.js (server.js)
   Database: JSON file (data.json)
   Charts Library: Chart.js (or similar)

---

4. APPLICATION STRUCTURE

4.1 Layout

* Left Sidebar Navigation
* Main Content Area
* Theme: Blue, White, Black (modern professional UI)

Sidebar Sections:

1. Dashboard
2. Manager Setup
3. SKU Master
4. History
5. Factory Dashboard
6. Production Pivot
7. Settings (placed at bottom)

---

5. MODULE REQUIREMENTS

5.1 DASHBOARD

Columns:

* in the top showing current shift and date and time
* Slot (Auto-generated: 1, 2, 3...)
* Active SKU (Fetched from Manager Setup line-by-line)
* Create Count

  * On click → show + / - buttons
  * Cannot go below 0
* Batch Code (Editable text field)
* Liters

  * Derived from SKU Master (Liters/Crate)
  * Formula: Create Count × Liters per crate
* Pieces

  * Derived from SKU Master (Pieces/Crate)
  * Formula: Create Count × Pieces per crate
* Looses

  * * / - controls
  * Each increment increases Pieces and Liters by 1 unit

Logic Rules:

* All calculations must update in real-time
* No negative values allowed
* Data must sync to History automatically

---

5.2 MANAGER SETUP

Fields:

* Slot (Editable)
* Running SKU (Editable dropdown from SKU Master)

Logic:

* Each slot maps to one SKU
* Data feeds into Dashboard Active SKU column

---

5.3 SKU MASTER

Add SKU via "+" button

Fields:

* Material Description
* Material Code
* Combine (Auto-generated: Description + "-" + Code, non-editable)
* Liters per Crate
* Pieces per Crate
* Category

Category:

* Can be created dynamically
* Stored and reused

Logic:

* Combine field auto-updates
* Data stored in structured JSON

---

5.4 HISTORY

Fields:

* Date
* Time
* Shift
* SKU
* Batch Code
* Crates
* Liters
* Pieces
* Looses

Shift Logic:

* Shifts defined in Settings
* When saving history:

  * Check current time
  * Match with shift time range
  * Assign corresponding shift

Behavior:

* Auto-update on Dashboard changes
* Immutable logs (no manual edits)

---

5.5 FACTORY DASHBOARD

Fields:

* SKU
* Batch Code
* Crates
* Liters

Logic:

* Data aggregated from Dashboard
* Real-time updates

---

5.6 PRODUCTION PIVOT

Features:

* Analytical charts (Bar, Pie, Line)
* Data Table

Data Source:

* History module

Filters:

* Date filter
* SKU filter (default = All)

Displayed Metrics:

* SKU
* Batch
* Crates
* Liters
* Pieces

Requirements:

* Charts must dynamically update
* Table must reflect filtered data

---

5.7 SETTINGS

Access Control:

* Requires Admin Password
* Default Password: 1234

Options:

1. Shift Management

   * Add/Edit/Delete shifts
   * Define time ranges

2. Admin Password

   * Change password

3. Backup Path

   * Define file storage location

Backup Logic:

* On every data change:

  * Rewrite backup file automatically
  * Maintain latest state

5. * Export reports (CSV and PDF) all data perfectly showing. 

---

6. DATA MANAGEMENT

6.1 data.json Structure

{
"sku_master": [],
"manager_setup": [],
"dashboard": [],
"history": [],
"settings": {
"shifts": [],
"admin_password": "1234",
"backup_path": ""
}
}

6.2 Rules

* All modules read/write from data.json
* Maintain normalized and structured format
* Avoid duplication
* Ensure atomic updates

---

7. SERVER REQUIREMENTS

File: server.js

Responsibilities:

* Serve static files (index.html)
* Provide API endpoints:

  * GET data
  * POST update
* Run on Node.js
* Launch app on local IP address

Example:
http://192.168.x.x:3000

---

8. UI/UX REQUIREMENTS

* Clean modern interface
* Color Theme: Blue, White, Black
* Responsive layout
* Sidebar navigation with active state
* Smooth transitions
* Button-based interactions (+ / - controls)

---

9. VALIDATION RULES

* No negative numeric values
* Required fields must not be empty
* SKU must exist before selection
* Shift time ranges must not overlap
* Password validation required for settings

---

10. PERFORMANCE REQUIREMENTS

* Real-time UI updates
* Efficient JSON read/write
* Minimal reloads (use DOM updates)
* Lightweight frontend

---

11. FUTURE ENHANCEMENTS (not need yet). 

* Multi-user support
* Authentication system
* Database migration (MongoDB / SQL)
* Cloud backup integration

---

END OF DOCUMENT
