"""Generic row-level trace accumulated as pipeline stages run.

``RowTrace`` records how a population changes as processors run: which rows
were considered, which stage first excluded a row, optional scores computed
mid-pipeline, and each survivor's final rank. The framework owns these mechanics
because they are generic pipeline behavior; application code chooses the writer,
identity column, stage labels, and table names that give the trace its domain
meaning.
"""

