// Test script for Copilot SDK integration
import { CopilotClient } from '@github/copilot-sdk';

async function testSdk() {
  console.log('[*] Testing Copilot SDK integration...\n');
  
  try {
    console.log('[>] Creating CopilotClient...');
    const client = new CopilotClient({
      autoStart: true,
      useLoggedInUser: true,
    });
    
    console.log('[>] Starting client...');
    await client.start();
    console.log('[+] Client started successfully!\n');
    
    console.log('[>] Creating session with gpt-4o...');
    const session = await client.createSession({
      model: 'gpt-4o',
    });
    console.log('[+] Session created: ' + session.sessionId + '\n');
    
    console.log('[>] Sending test prompt...');
    const testPrompt = 'Respond with exactly: "SDK TEST SUCCESSFUL"';
    
    const response = await session.sendAndWait({ prompt: testPrompt }, 30000);
    
    console.log('\n[+] Response received:');
    console.log('---');
    console.log(response?.data?.content || '(no content)');
    console.log('---\n');
    
    console.log('[>] Cleaning up session...');
    await session.destroy();
    
    console.log('[>] Stopping client...');
    await client.stop();
    
    console.log('\n[*] SDK TEST COMPLETE - ALL SYSTEMS OPERATIONAL');
    console.log('[*] copilot-guardian is ready to use Copilot SDK!');
    
  } catch (error) {
    console.error('\n[-] SDK TEST FAILED:');
    console.error(error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testSdk();
