import 'dotenv/config';
import { streamText } from 'ai';

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error('Missing AI_GATEWAY_API_KEY — set it in .env.local first.');
    process.exit(1);
  }

  const result = streamText({
    model: 'openai/gpt-5.6-sol',
    prompt: 'Say hello, then explain in one sentence what an AI Gateway does.',
  });

  process.stdout.write('--- streamed response ---\n');
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n\n');

  const usage = await result.usage;
  console.log('--- token usage ---');
  console.log(usage);
}

main().catch((err) => {
  console.error('AI Gateway call failed:', err);
  process.exit(1);
});
