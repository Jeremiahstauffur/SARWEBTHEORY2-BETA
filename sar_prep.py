import json
import sys
import os
import math
from typing import List, Dict, Any

try:
    import geopandas as gpd
    from shapely.geometry import shape
    import pyproj
except ImportError:
    print("Missing dependencies. Please install: pip install geopandas shapely pyproj pyogrio")
    sys.exit(1)

def process_geojson(input_path: str):
    """
    Reads a GIS file and extracts segments with Area (acres) and Length (miles).
    Outputs a JSON compatible with SARWebTheory import.
    """
    print(f"Processing {input_path}...")
    
    try:
        gdf = gpd.read_file(input_path)
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # Ensure we have a CRS
    if gdf.crs is None:
        print("Warning: No CRS found, assuming WGS84 (EPSG:4326)")
        gdf.set_crs(epsg=4326, inplace=True)

    # Convert to a suitable projected CRS for accurate area/length (Web Mercator)
    gdf_proj = gdf.to_crs(epsg=3857)

    results = []
    
    # Common property names to check
    name_cols = ['name', 'segment', 'label', 'title', 'id', 'id_number']
    
    for idx, row in gdf.iterrows():
        # Determine name
        name = os.path.basename(input_path).replace('.json', '')
        for col in name_cols:
            if col in gdf.columns and row[col] and str(row[col]).strip():
                name = str(row[col])
                break
        
        if len(gdf) > 1 and name == os.path.basename(input_path).replace('.json', ''):
            name = f"{name} - {idx + 1}"

        # Calculate Area (Acres)
        # 1 square meter = 0.000247105 acres
        area_acres = gdf_proj.geometry.iloc[idx].area * 0.000247105
        
        # Calculate Length (Miles)
        # 1 meter = 0.000621371 miles
        geom = gdf_proj.geometry.iloc[idx]
        if geom.geom_type in ['Polygon', 'MultiPolygon']:
            bounds = geom.bounds # (minx, miny, maxx, maxy)
            width = bounds[2] - bounds[0]
            height = bounds[3] - bounds[1]
            length_miles = max(width, height) * 0.000621371
        else:
            length_miles = geom.length * 0.000621371
        
        results.append({
            "segment": name,
            "area": round(area_acres, 2) if area_acres > 0 else "",
            "length": round(length_miles, 2) if length_miles > 0 else "",
            "sweep": 20
        })

    output_path = "sar_imported_segments.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2)
    
    print(f"Success! Exported {len(results)} segments to {output_path}")
    print("You can now upload this file to the 'Uploads' page and import it.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python sar_prep.py <input_gis_file>")
    else:
        process_geojson(sys.argv[1])
