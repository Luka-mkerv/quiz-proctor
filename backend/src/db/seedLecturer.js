// Usage (from inside the backend container or with DATABASE_URL set locally):
//   node src/db/seedLecturer.js "prof@university.edu" "yourpassword" "Prof. Name"
require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./pool");

async function seedLecturer() {
  const [, , email, password, fullName] = process.argv;

  if (!email || !password || !fullName) {
    console.error('Usage: node src/db/seedLecturer.js "email" "password" "Full Name"');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO lecturers (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, email, full_name`,
      [email.toLowerCase().trim(), passwordHash, fullName]
    );
    console.log("Lecturer ready:", rows[0]);
  } catch (err) {
    console.error("Failed to seed lecturer:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedLecturer();
