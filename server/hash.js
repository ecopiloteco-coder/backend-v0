const bcrypt = require('bcryptjs');

async function hashPassword(password) {
  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);
  console.log('Generated hash:', hash);
  return hash;
}

// Call the function with your desired password
hashPassword('admin123')
  .then(() => {
    console.log('Hashing complete. Update the database with the generated hash.');
  })
  .catch((err) => {
    console.error('Error hashing password:', err);
  });