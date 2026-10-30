import fs from 'fs';

const html = fs.readFileSync('C:/Users/Adi/Downloads/MapWell_ Community Health Mapping (1).html', 'utf8');
const startTag = '<script type="application/json" id="geo-data">';
const endTag = '</script>';

const startIndex = html.indexOf(startTag);
if (startIndex !== -1) {
  const jsonStart = startIndex + startTag.length;
  const jsonEnd = html.indexOf(endTag, jsonStart);
  if (jsonEnd !== -1) {
    const geoData = html.slice(jsonStart, jsonEnd).trim();
    if (!fs.existsSync('c:/Users/Adi/Desktop/mapwell/client/public')) {
      fs.mkdirSync('c:/Users/Adi/Desktop/mapwell/client/public', { recursive: true });
    }
    fs.writeFileSync('c:/Users/Adi/Desktop/mapwell/client/public/us-counties.json', geoData);
    console.log(`Successfully extracted us-counties.json! Size: ${(geoData.length / 1024).toFixed(1)} KB`);
  } else {
    console.error('End tag not found');
  }
} else {
  console.error('Start tag not found');
}
