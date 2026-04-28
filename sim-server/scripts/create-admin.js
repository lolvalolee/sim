// scripts/create-admin.js — Run once to create superadmin account
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');
require('dotenv').config();

const db = new Database(process.env.DB_PATH || './data/simulator.db');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function main() {
  console.log('\n🔧 Docaa Simulator — Create Superadmin\n');

  const existing = db.prepare("SELECT id FROM users WHERE role='superadmin'").get();
  if (existing) {
    console.log('⚠️  Superadmin already exists. Delete from DB to recreate.');
    process.exit(0);
  }

  const email = await ask('Email: ');
  const name  = await ask('Name: ');
  const pass  = await ask('Password (min 8 chars): ');

  if (pass.length < 8) { console.log('❌ Password too short'); process.exit(1); }

  const hash = await bcrypt.hash(pass, 12);
  const id   = uuidv4();

  db.prepare(`INSERT INTO users (id,email,name,password,role) VALUES (?,?,?,?,?)`)
    .run(id, email.trim(), name.trim(), hash, 'superadmin');

  console.log(`\n✅ Superadmin created: ${email}`);
  console.log(`   ID: ${id}`);
  rl.close();
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
