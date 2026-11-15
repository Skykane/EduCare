const http = require('http');

http.get('http://localhost:3000/equipment', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    const hasSubCollege = data.includes('<span class="sub">College of ICT</span>');
    console.log('Contains <span class="sub">College of ICT</span>:', hasSubCollege);
    const matches = data.match(/<td>(CCS Computer Lab 1|Audio-Visual Room|Library)[^<]*<\/td>/g);
    console.log('Sample location cells:', matches ? matches.slice(0, 3) : 'none');
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});
