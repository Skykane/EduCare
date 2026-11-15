// Sample data so the system can be demoed right away.
// Runs automatically when the database is empty. `npm run seed` wipes and re-seeds.
const bcrypt = require('bcryptjs');
const db = require('./db');
const { todayISO, addDays } = require('./helpers');

function daysAgo(n, hour = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const DEMO_ACCOUNTS = [
  { role: 'Administrator', email: 'admin@educare.local', password: 'admin123' },
  { role: 'Technician', email: 'robert@educare.local', password: 'robert123' },
  { role: 'Technician', email: 'jovert@educare.local', password: 'jovert456' },
  { role: 'Requester', email: 'ana@educare.local', password: 'user123' },
];

function seed() {
  db.reset();
  const t = todayISO();
  const hash = (p) => bcrypt.hashSync(p, 10);

  // Categories
  const cat = {};
  [
    ['Computers & IT', 'Desktops, laptops, printers, and peripherals'],
    ['Networking', 'Routers, switches, access points, and cabling'],
    ['Electrical', 'Lighting, outlets, generators, and wiring'],
    ['Air Conditioning', 'Aircon units and ventilation'],
    ['Laboratory Equipment', 'Science laboratory instruments and devices'],
    ['Audio-Visual', 'Projectors, TVs, speakers, and microphones'],
    ['Furniture & Fixtures', 'Chairs, tables, cabinets, and doors'],
  ].forEach(([name, description]) => {
    cat[name] = db.insert('categories', { name, description }).id;
  });

  // Users
  const user = (u) => db.insert('users', { phone: '', active: true, specializations: [], availability: null, ...u });
  const admin = user({ name: 'System Administrator', email: 'admin@educare.local', passwordHash: hash('admin123'), role: 'admin', department: 'Facilities Office' });
  const robert = user({ name: 'Robert Cruz', email: 'robert@educare.local', passwordHash: hash('robert123'), role: 'technician', department: 'Maintenance Unit', phone: '09170000001', specializations: [cat['Computers & IT'], cat['Networking'], cat['Laboratory Equipment']], availability: 'Available' });
  const jovert = user({ name: 'Jovert Cruz', email: 'jovert@educare.local', passwordHash: hash('jovert456'), role: 'technician', department: 'Maintenance Unit', phone: '09170000002', specializations: [cat['Electrical'], cat['Air Conditioning'], cat['Furniture & Fixtures'], cat['Audio-Visual']], availability: 'Available' });
  const ana = user({ name: 'Ana Garcia', email: 'ana@educare.local', passwordHash: hash('user123'), role: 'requester', department: 'College of ICT', studentId: '2024-00103' });
  const jose = user({ name: 'Jose Ramos', email: 'jose@educare.local', passwordHash: hash('user123'), role: 'requester', department: "Registrar's Office", studentId: '2024-00104' });

  // Official High School Student Database
  const { ensureStudentsDatabase } = require('./services/studentVerification');
  ensureStudentsDatabase();

  // Equipment
  const eq = {};
  const equipment = (code, e) => {
    eq[code] = db.insert('equipment', { code, notes: '', ...e, createdAt: daysAgo(400) });
  };
  equipment('EQ-0001', { name: 'Desktop Computer (Lab PC-01)', model: 'Acer Veriton X2690G', serialNumber: 'ACR-VX-2201', categoryId: cat['Computers & IT'], department: 'Junior High School', location: 'Computer Laboratory', acquisitionDate: addDays(t, -900), status: 'Needs Repair', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -170) });
  equipment('EQ-0002', { name: 'Laser Printer', model: 'HP LaserJet Pro M404dn', serialNumber: 'HP-M404-7781', categoryId: cat['Computers & IT'], department: 'Administration', location: "Principal's Office", acquisitionDate: addDays(t, -1200), status: 'Needs Repair', importance: 4, maintenanceIntervalDays: 90, lastMaintenanceDate: addDays(t, -85) });
  equipment('EQ-0003', { name: 'Network Switch 24-Port', model: 'TP-Link TL-SG1024D', serialNumber: 'TPL-SW-5520', categoryId: cat['Networking'], department: 'ICT Department', location: 'Server Room', acquisitionDate: addDays(t, -700), status: 'Needs Repair', importance: 5, maintenanceIntervalDays: 120, lastMaintenanceDate: addDays(t, -130) });
  equipment('EQ-0004', { name: 'Split-Type Aircon 2.0HP', model: 'Carrier Optima', serialNumber: 'CAR-OPT-3321', categoryId: cat['Air Conditioning'], department: 'Senior High School', location: 'Grade 11 - GAS (Room 301)', acquisitionDate: addDays(t, -1000), status: 'Under Maintenance', importance: 4, maintenanceIntervalDays: 90, lastMaintenanceDate: addDays(t, -60) });
  equipment('EQ-0005', { name: 'LCD Projector', model: 'Epson EB-X51', serialNumber: 'EPS-X51-9932', categoryId: cat['Audio-Visual'], department: 'Junior High School', location: 'Grade 9 - Room 201', acquisitionDate: addDays(t, -600), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -40) });
  equipment('EQ-0006', { name: 'Generator Set 10kVA', model: 'Firman FPG10000', serialNumber: 'FRM-10K-0042', categoryId: cat['Electrical'], department: 'Facilities Office', location: 'Generator House', acquisitionDate: addDays(t, -1500), status: 'Operational', importance: 5, maintenanceIntervalDays: 30, lastMaintenanceDate: addDays(t, -36) });
  equipment('EQ-0007', { name: 'Compound Microscope', model: 'Olympus CX23', serialNumber: 'OLY-CX23-1102', categoryId: cat['Laboratory Equipment'], department: 'Junior High School', location: 'Science Laboratory', acquisitionDate: addDays(t, -800), status: 'Out of Service', importance: 2, maintenanceIntervalDays: 365, lastMaintenanceDate: addDays(t, -200) });
  equipment('EQ-0008', { name: 'Wireless Access Point', model: 'Ubiquiti UniFi U6 Lite', serialNumber: 'UBQ-U6L-4410', categoryId: cat['Networking'], department: 'Library Services', location: 'High School Library', acquisitionDate: addDays(t, -400), status: 'Operational', importance: 4, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -100) });
  equipment('EQ-0009', { name: "Teacher's Desktop PC", model: 'Lenovo ThinkCentre M720q', serialNumber: 'LNV-TC-0019', categoryId: cat['Computers & IT'], department: 'Junior High School', location: 'Grade 7 - Room 101', acquisitionDate: addDays(t, -2000), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: null });
  equipment('EQ-0010', { name: 'Faculty Laptop', model: 'Lenovo ThinkPad E14', serialNumber: 'LNV-E14-7731', categoryId: cat['Computers & IT'], department: 'Junior High School', location: 'Faculty Room', acquisitionDate: addDays(t, -150), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: null });
  equipment('EQ-0011', { name: 'Smart TV 55-inch UHD', model: 'LG UHD AI ThinQ 55"', serialNumber: 'LG-55UQ-9011', categoryId: cat['Audio-Visual'], department: 'Senior High School', location: 'Grade 12 - GAS (Room 302)', acquisitionDate: addDays(t, -300), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -20) });
  equipment('EQ-0012', { name: 'Classroom Desktop PC', model: 'Dell OptiPlex 3080', serialNumber: 'DEL-OPT-3080', categoryId: cat['Computers & IT'], department: 'Junior High School', location: 'Grade 10 - Room 203', acquisitionDate: addDays(t, -400), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -50) });
  equipment('EQ-0013', { name: 'Smart TV 50-inch', model: 'Samsung Crystal UHD 50"', serialNumber: 'SAM-TV-5088', categoryId: cat['Audio-Visual'], department: 'Junior High School', location: 'Grade 8 - Room 103', acquisitionDate: addDays(t, -300), status: 'Operational', importance: 3, maintenanceIntervalDays: 180, lastMaintenanceDate: addDays(t, -30) });

  // Repair requests with their activity history
  const act = (a) => db.insert('activities', { requestId: null, equipmentId: null, userId: null, details: '', fromStatus: null, toStatus: null, ...a });
  const request = (code, r, events) => {
    const row = db.insert('requests', {
      code,
      type: 'Corrective',
      priority: null,
      technicianId: null,
      targetDate: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      ...r,
      updatedAt: r.createdAt,
    });
    act({ requestId: row.id, equipmentId: row.equipmentId, userId: row.requesterId, action: 'Request submitted', details: row.title, toStatus: 'Pending', createdAt: row.createdAt });
    for (const e of events || []) act({ requestId: row.id, equipmentId: row.equipmentId, ...e });
    return row;
  };

  request('REQ-0001', { equipmentId: eq['EQ-0005'].id, requesterId: ana.id, title: 'Projector has no display and flickers', description: 'The projector in Room 201 turns on but the screen flickers and sometimes shows no signal from the laptop.', severity: 2, status: 'Completed', priority: 'Medium', technicianId: jovert.id, targetDate: addDays(t, -16), createdAt: daysAgo(20, 8), assignedAt: daysAgo(19, 10), startedAt: daysAgo(18, 9), completedAt: daysAgo(17, 15) }, [
    { userId: admin.id, action: 'Priority set', details: 'Priority set to Medium', createdAt: daysAgo(19, 10) },
    { userId: admin.id, action: 'Technician assigned', details: `Assigned to ${jovert.name}, target ${addDays(t, -16)}`, fromStatus: 'Pending', toStatus: 'Assigned', createdAt: daysAgo(19, 10) },
    { userId: jovert.id, action: 'Work started', fromStatus: 'Assigned', toStatus: 'In Progress', createdAt: daysAgo(18, 9) },
    { userId: jovert.id, action: 'Repair completed', details: 'Re-soldered HDMI port and cleaned the air filter.', fromStatus: 'In Progress', toStatus: 'Completed', createdAt: daysAgo(17, 15) },
  ]);
  const r2 = request('REQ-0002', { equipmentId: eq['EQ-0004'].id, requesterId: ana.id, title: 'Aircon not cooling and leaking water', description: 'Aircon in Computer Lab 1 only blows warm air and water drips from the indoor unit onto the floor.', severity: 3, status: 'In Progress', priority: 'High', technicianId: jovert.id, targetDate: addDays(t, 1), createdAt: daysAgo(5, 8), assignedAt: daysAgo(4, 9), startedAt: daysAgo(2, 10) }, [
    { userId: admin.id, action: 'Priority set', details: 'Priority set to High', createdAt: daysAgo(4, 9) },
    { userId: admin.id, action: 'Technician assigned', details: `Assigned to ${jovert.name}, target ${addDays(t, 1)}`, fromStatus: 'Pending', toStatus: 'Assigned', createdAt: daysAgo(4, 9) },
    { userId: jovert.id, action: 'Work started', details: 'Checking refrigerant level and drain line.', fromStatus: 'Assigned', toStatus: 'In Progress', createdAt: daysAgo(2, 10) },
  ]);
  const r3 = request('REQ-0003', { equipmentId: eq['EQ-0007'].id, requesterId: ana.id, title: 'Microscope fine focus knob broken, lamp not lighting', description: 'Fine focus knob spins freely and the illuminator lamp does not turn on.', severity: 2, status: 'Assigned', priority: 'Medium', technicianId: jovert.id, targetDate: addDays(t, -2), createdAt: daysAgo(9, 13), assignedAt: daysAgo(8, 9) }, [
    { userId: admin.id, action: 'Technician assigned', details: `Assigned to ${jovert.name}, target ${addDays(t, -2)}`, fromStatus: 'Pending', toStatus: 'Assigned', createdAt: daysAgo(8, 9) },
  ]);
  request('REQ-0004', { equipmentId: eq['EQ-0002'].id, requesterId: jose.id, title: 'Printer paper jam and streaks on printouts', description: 'Paper jams every few pages and printouts have black vertical streaks. Used for printing transcripts.', severity: 3, status: 'Pending', createdAt: daysAgo(3, 11) });
  request('REQ-0005', { equipmentId: eq['EQ-0001'].id, requesterId: ana.id, title: "Lab PC-01 won't boot (beeping)", description: 'The PC beeps three times on power on and does not display anything.', severity: 2, status: 'Pending', createdAt: daysAgo(1, 14) });
  request('REQ-0006', { equipmentId: eq['EQ-0003'].id, requesterId: jose.id, title: 'Intermittent network drops in Lab 1 and offices', description: 'Internet and LAN connection drops every few minutes. Switch lights blink amber on several ports.', severity: 4, status: 'Pending', createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() });

  // Maintenance history
  const record = (r) => db.insert('maintenanceRecords', { requestId: null, remarks: '', ...r });
  record({ equipmentId: eq['EQ-0005'].id, requestId: 1, technicianId: jovert.id, type: 'Corrective', problem: 'Loose HDMI port and dusty air filter causing overheating', actionsTaken: 'Re-soldered HDMI port, cleaned air filter and vents', partsReplaced: 'HDMI port module', serviceDate: addDays(t, -17), resultingStatus: 'Operational', createdAt: daysAgo(17, 15) });
  record({ equipmentId: eq['EQ-0003'].id, technicianId: robert.id, type: 'Preventive', problem: 'Routine inspection', actionsTaken: 'Cleaned dust, checked port LEDs, re-terminated two cables', partsReplaced: '2 RJ45 connectors', serviceDate: addDays(t, -130), resultingStatus: 'Operational', createdAt: daysAgo(130, 10) });
  record({ equipmentId: eq['EQ-0006'].id, technicianId: jovert.id, type: 'Preventive', problem: 'Monthly generator inspection', actionsTaken: 'Test run 30 minutes, checked oil and battery', partsReplaced: '', serviceDate: addDays(t, -36), resultingStatus: 'Operational', createdAt: daysAgo(36, 10) });
  record({ equipmentId: eq['EQ-0001'].id, technicianId: robert.id, type: 'Preventive', problem: 'Semi-annual PC maintenance', actionsTaken: 'Cleaned internals, replaced thermal paste, updated OS', partsReplaced: 'Thermal paste', serviceDate: addDays(t, -170), resultingStatus: 'Operational', createdAt: daysAgo(170, 10) });
  record({ equipmentId: eq['EQ-0004'].id, technicianId: jovert.id, type: 'Preventive', problem: 'Quarterly aircon cleaning', actionsTaken: 'Cleaned filters and coils, checked refrigerant pressure', partsReplaced: '', serviceDate: addDays(t, -60), resultingStatus: 'Operational', createdAt: daysAgo(60, 10) });

  // Notifications
  const note = (n) => db.insert('notifications', { read: false, type: 'info', dedupeKey: null, ...n });
  note({ userId: jovert.id, message: `New assignment: ${r2.code} – ${r2.title}`, link: `/requests/${r2.id}`, createdAt: daysAgo(4, 9) });
  note({ userId: jovert.id, message: `New assignment: ${r3.code} – ${r3.title}`, link: `/requests/${r3.id}`, createdAt: daysAgo(8, 9) });
  note({ userId: ana.id, message: `${r2.code} is now In Progress.`, link: `/requests/${r2.id}`, createdAt: daysAgo(2, 10) });
}

function seedIfEmpty() {
  if (db.all('users').length === 0) {
    seed();
    return true;
  }
  return false;
}

if (require.main === module) {
  db.load();
  if (process.argv.includes('--reset') || db.all('users').length === 0) {
    seed();
    console.log('Database seeded with sample data.');
    console.log('Demo accounts:');
    for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(14)} ${a.email} / ${a.password}`);
  } else {
    console.log('Database already has data. Use "npm run seed" to reset it.');
  }
}

module.exports = { seed, seedIfEmpty, DEMO_ACCOUNTS };
