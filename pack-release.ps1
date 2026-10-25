$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = $PSScriptRoot
$version = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json).version
$releaseDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$releasePath = Join-Path $releaseDir ("job-form-autofill-" + $version + "-source.zip")
if (Test-Path -LiteralPath $releasePath) { throw "Archive already exists: $releasePath" }
# Explicit source allowlist: never recursively package the workspace or local data.
# Keep this script ASCII-compatible with Windows PowerShell 5.1's default encoding.
$localizedLauncher = (-join ([char[]](0x542f, 0x52a8, 0x540e, 0x53f0))) + '.bat'
$sources = @(
  '.gitignore', '.dockerignore', '.env.example', 'LICENSE', 'README.md', 'manifest.json', 'package.json',
  'Dockerfile', 'compose.yaml', '.github/workflows/test.yml',
  'background.js', 'core.js', 'content.js', 'project-fields.js', 'project-content.js',
  'select-controls.js', 'preference-values.js', 'education-records.js',
  'page-context.js',
  'popup.html', 'popup.css', 'popup.js', 'options.html', 'options.css', 'options.js',
  'start-backend.bat', $localizedLauncher, 'pack-release.ps1',
  'backend/app.py', 'backend/storage.py', 'backend/matcher.py',
  'backend/requirements.txt', 'backend/requirements.lock', 'backend/test_matcher.py',
  'backend/interview/__init__.py', 'backend/interview/config.py', 'backend/interview/schemas.py',
  'backend/interview/extraction.py', 'backend/interview/providers.py', 'backend/interview/prompts.py',
  'backend/interview/mock_provider.py', 'backend/interview/store.py',
  'backend/interview/workflow.py', 'backend/interview/routes.py',
  'backend/dashboard/index.html', 'backend/dashboard/style.css', 'backend/dashboard/app.js',
  'backend/dashboard/demo.html', 'backend/dashboard/demo.js',
  'backend/dashboard/profile.js',
  'backend/dashboard/select-demo.html', 'backend/dashboard/select-demo.js',
  'backend/dashboard/interview.html', 'backend/dashboard/interview.js', 'backend/dashboard/interview.css',
  'tests/core.test.js', 'tests/projects.test.js', 'tests/e2e.cjs',
  'tests/page-context.test.js', 'tests/preference-values.test.js', 'tests/education-records.test.js', 'tests/dropdowns.e2e.cjs',
  'tests/test_agent_api.py', 'tests/test_agent_store.py', 'tests/test_extraction.py', 'tests/test_provider.py', 'tests/interview.e2e.cjs',
  'scripts/check.py', 'scripts/serve.py', 'examples/resume.txt', 'examples/job_description.txt',
  'docs/project_audit.md', 'docs/design.md', 'docs/extension-guide.md'
)
# Fail before creating a partial archive when the release list is incomplete.
foreach ($relativePath in $sources) {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
    throw "Missing release source: $relativePath"
  }
}
$archive = [System.IO.Compression.ZipFile]::Open($releasePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relativePath in $sources) {
    $sourcePath = Join-Path $projectRoot $relativePath
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourcePath, "job-form-autofill-extension/$relativePath") | Out-Null
  }
} finally { $archive.Dispose() }
Write-Output $releasePath
