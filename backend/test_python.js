import { spawn } from 'child_process';

const python = spawn('python', ['timestamp_parser.py']);

python.stdin.write(JSON.stringify("2024-01-01T10:30:00"));
python.stdin.end();

python.stdout.on('data', (data) => {
    console.log('Python output:', data.toString());
});

python.stderr.on('data', (data) => {
    console.error('Python error:', data.toString());
});