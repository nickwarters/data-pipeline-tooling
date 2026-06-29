# Testing External Systems & Orchestration

Pipelines often don't just read local files; they trigger external jobs, query remote APIs, or orchestrate tools like a remote SAS server or Databricks. If your pipeline code directly imports a network library (like `paramiko` or `requests`) and wires up the remote call, your tests become a nightmare of mocking network side-effects.

To maintain granular, fast, in-memory testability, we decouple the **intent** of the orchestration from the **mechanism** of the network call using **Dependency Injection** and a **Boundary Protocol**.

## 1. Define the Boundary (The Protocol)

Create a strict interface representing what the external system *can do for us*, completely ignoring *how* it connects. For example, if we need to run a SAS script and pull down the generated CSVs:

```python
from typing import Protocol
from pathlib import Path

class SasRemoteClient(Protocol):
    def execute_script(self, script_path: str) -> str:
        """Triggers a remote SAS script and returns the execution job ID."""
        ...

    def fetch_extracts(self, job_id: str, dest_dir: Path) -> list[Path]:
        """Downloads the generated CSVs for a job to dest_dir and returns their local paths."""
        ...
```

## 2. Build the Orchestrator

Your orchestration layer takes this client as a dependency rather than instantiating the connection itself. Its job is purely logistical: run the script, fetch the files, and hand them off to the pipeline runners.

```python
from framework.run import RunContext

def run_complaints_orchestrator(
    sas_client: SasRemoteClient, 
    landing_zone: Path, 
    context: RunContext
) -> None:
    # 1. Trigger SAS
    job_id = sas_client.execute_script("/sas/scripts/weekly_complaints_export.sas")
    
    # 2. Fetch the newly generated CSVs to the local landing zone
    sas_client.fetch_extracts(job_id, landing_zone)
    
    # 3. Trigger the downstream pipelines
    # (The pipelines expect their specific files to be present in the landing_zone)
    from pipelines.complaints_a.pipeline import run as run_a
    from pipelines.complaints_b.pipeline import run as run_b
    from pipelines.complaints_c.pipeline import run as run_c
    
    run_a(context)
    run_b(context)
    run_c(context)
```

## 3. Write the "Fake" for Testing

Instead of using `unittest.mock.MagicMock` (which can be brittle and fails to verify multi-step behaviour effectively), we write a lightweight, in-memory `Fake` that implements the protocol. It behaves like the real external server but operates locally.

```python
class FakeSasClient:
    def __init__(self):
        self.executed_scripts = []
        self.files_to_serve = {}  # Map of filename -> csv string content
        
    def execute_script(self, script_path: str) -> str:
        self.executed_scripts.append(script_path)
        return "fake-job-123"
        
    def fetch_extracts(self, job_id: str, dest_dir: Path) -> list[Path]:
        assert job_id == "fake-job-123"
        downloaded = []
        
        # Simulate an SFTP/Network download by writing our fake files to the disk
        for filename, content in self.files_to_serve.items():
            path = dest_dir / filename
            path.write_text(content, encoding="utf-8")
            downloaded.append(path)
            
        return downloaded
```

## 4. The Granular Test

Now we can thoroughly test our orchestration logic without ever touching a network, spinning up a server, or writing flaky remote tests.

```python
from framework.io import StoreCatalog
from tests.framework_testing import read_rows
from tools.medallion import medallion

def test_orchestrator_triggers_sas_and_drives_pipelines(tmp_path):
    # Setup the fake SAS environment with our expected CSV outputs
    sas_client = FakeSasClient()
    sas_client.files_to_serve = {
        "complaints_a.csv": "record_id,label,amount\nA1,foo,50\n",
        "complaints_b.csv": "record_id,category,priority\nB1,sales,high\n",
        "complaints_c.csv": "record_id,department,resolution_days\nC1,hr,5\n"
    }
    
    landing_zone = tmp_path / "landing_zone"
    landing_zone.mkdir()
    context = RunContext(base_dir=tmp_path, pipeline="orchestrator")
    
    # Execute the orchestrator
    run_complaints_orchestrator(sas_client, landing_zone, context)
    
    # Assert 1: The orchestrator ran the correct script remotely
    assert "/sas/scripts/weekly_complaints_export.sas" in sas_client.executed_scripts
    
    # Assert 2: The CSV files successfully landed in the landing zone
    assert (landing_zone / "complaints_a.csv").exists()
    
    # Assert 3: The downstream pipelines successfully picked them up and ran
    catalog = StoreCatalog(tmp_path)
    silver_a = read_rows(medallion(catalog, "complaints_a").silver, "complaints_a")
    silver_b = read_rows(medallion(catalog, "complaints_b").silver, "complaints_b")
    
    assert len(silver_a) == 1
    assert silver_a[0]["amount"] == 50
    assert len(silver_b) == 1
    assert silver_b[0]["priority"] == "high"
```

## Why this works so well

- **Resilient to Platform Change:** If you swap SAS out for a Databricks job, or switch from SFTP to AWS S3, the orchestrator and its test **do not change**. You simply build a new production implementation of the `SasRemoteClient` (e.g. `S3DatabricksClient`).
- **Tests the Integration, not the Implementation:** It verifies that if files land, the downstream pipelines are successfully triggered in sequence and refine the data.
- **Fast:** It executes entirely locally in milliseconds, with zero network latency.
