export default function Home() {
  return (
    <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">🔍 AI Bug Detector</h1>
        <p className="text-gray-400 mb-8">
          AI-Powered GitHub Code Reviewer
        </p>
        <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-auto">
          <h2 className="text-xl font-semibold mb-4">Status</h2>
          <div className="space-y-2 text-left">
            <div className="flex justify-between">
              <span>API Endpoint:</span>
              <span className="text-green-400">/api/webhook ✓</span>
            </div>
            <div className="flex justify-between">
              <span>Ready for PRs:</span>
              <span className="text-green-400">Yes ✓</span>
            </div>
          </div>
        </div>
        <p className="text-gray-500 text-sm mt-8">
          Create a Pull Request to trigger analysis
        </p>
      </div>
    </main>
  );
}
