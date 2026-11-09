import * as THREE from 'three';

// --- CUSTOM TUBE PAINTER CLASS (Variable Width Support) ---
class VariableTubePainter {
    constructor(maxPoints = 100000) {
        this.type = 'VariableTubePainter';

        // Configuration
        this.minDistance = 0.003; // 1mm threshold
        this.radialSegments = 8;
        this.maxPoints = maxPoints;

        // State
        this.geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.maxPoints * 3);
        this.normals = new Float32Array(this.maxPoints * 3);

        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));

        this.drawCount = 0; // Number of vertices currently used
        this.geometry.setDrawRange(0, 0);
        this.points = [];
        this.widths = [];
        this.boundingBox = new THREE.Box3();

        // Helpers for math (to avoid creating objects in the loop)
        this.prevPos = new THREE.Vector3();
        this.currPos = new THREE.Vector3();
        this.diff = new THREE.Vector3();
        this.up = new THREE.Vector3(0, 1, 0); // Current "Up" vector to minimize twist

        this.matrix = new THREE.Matrix4();
        this.right = new THREE.Vector3();
        this.forward = new THREE.Vector3();

        // Store the vertex ring of the previous step to connect triangles
        this.prevRingVertices = [];
        this.hasStart = false;
    }

    // Only takes Position (Vector3). Resets the stroke.
    moveTo(position) {
        this.prevPos.copy(position);
        this.hasStart = true;
        this.points = [position.clone()];
        this.widths = [0];
        this.boundingBox.setFromPoints(this.points);

        // Reset internal state for a new stroke, but we don't clear the geometry 
        // (this implementation assumes one mesh per stroke for simplicity in this demo).
        // If reusing the same mesh for multiple strokes, you'd need index management.
        this.drawCount = 0;
        this.geometry.setDrawRange(0, 0);

        // Reset Up vector to default to avoid twist inheritance from previous unknown states
        this.up.set(0, 1, 0);
        this.prevRingVertices = [];
    }

    // Only takes Position and Width.
    lineTo(position, width) {
        if (!this.hasStart) {
            this.moveTo(position);
            return;
        }

        // 1. Distance Check (Threshold)
        const dist = this.prevPos.distanceTo(position);
        if (dist < this.minDistance) {
            return; // Skip if didn't move enough
        }

        this.currPos.copy(position);
        this.points.push(this.currPos.clone());
        if (this.points.length === 2) this.widths[0] = width;
        this.widths.push(width);
        this.boundingBox.expandByPoint(this.currPos);

        // 2. Calculate Orientation Frame
        // Forward direction
        this.forward.subVectors(this.currPos, this.prevPos).normalize();

        // Calculate Right vector (Cross product of Forward and Up)
        this.right.crossVectors(this.forward, this.up).normalize();

        // Recalculate Up vector to ensure orthogonality (Cross product of Right and Forward)
        this.up.crossVectors(this.right, this.forward).normalize();

        // Create a matrix from these basis vectors (Rotation Matrix)
        // This matrix transforms a circle on the XY plane to be perpendicular to our path
        this.matrix.set(
            this.right.x, this.up.x, this.forward.x, this.currPos.x,
            this.right.y, this.up.y, this.forward.y, this.currPos.y,
            this.right.z, this.up.z, this.forward.z, this.currPos.z,
            0, 0, 0, 1
        );

        // 3. Generate New Ring of Vertices
        const currentRingVertices = [];
        const segs = this.radialSegments;

        for (let s = 0; s <= segs; s++) {
            // We go <= segs to duplicate the first vertex at the end for texture/UV closure (if needed),
            // though for flat colors < segs is enough. Let's stick to < segs and wrap logic manually for index.
            // Actually, standard strip logic: generate `segs` points.
        }

        const tempPos = new THREE.Vector3();
        const tempNorm = new THREE.Vector3();

        for (let s = 0; s < segs; s++) {
            const angle = (s / segs) * Math.PI * 2;

            // Create circle on XY plane, scaled by width
            const cx = Math.cos(angle) * width;
            const cy = Math.sin(angle) * width;

            // Apply transform
            tempPos.set(cx, cy, 0).applyMatrix4(this.matrix);
            // Normal is just the vector from center (currPos) to vertex, normalized
            tempNorm.subVectors(tempPos, this.currPos).normalize();

            currentRingVertices.push({
                pos: tempPos.clone(),
                norm: tempNorm.clone()
            });
        }

        // 4. Triangulate (Connect Previous Ring to Current Ring)
        if (this.prevRingVertices.length > 0) {
            this.addSegment(this.prevRingVertices, currentRingVertices);
        } else {
            // Special Case: First segment. 
            // We need a start ring at prevPos. We can simply back-calculate it 
            // using the same orientation but placed at prevPos.

            const startRing = [];
            this.matrix.setPosition(this.prevPos); // Temporarily move matrix back

            for (let s = 0; s < segs; s++) {
                const angle = (s / segs) * Math.PI * 2;
                const cx = Math.cos(angle) * width; // Start width (could be 0 for tapered start)
                const cy = Math.sin(angle) * width;

                tempPos.set(cx, cy, 0).applyMatrix4(this.matrix);
                tempNorm.subVectors(tempPos, this.prevPos).normalize();

                startRing.push({ pos: tempPos.clone(), norm: tempNorm.clone() });
            }

            this.addSegment(startRing, currentRingVertices);
        }

        // 5. Update State
        this.prevPos.copy(this.currPos);
        this.prevRingVertices = currentRingVertices;

        // Update Geometry
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.normal.needsUpdate = true;
        this.geometry.setDrawRange(0, this.drawCount);
    }

    addSegment(ring1, ring2) {
        const segs = this.radialSegments;

        for (let s = 0; s < segs; s++) {
            const nextS = (s + 1) % segs;

            // Four vertices of the quad
            const v1 = ring1[s];
            const v2 = ring1[nextS];
            const v3 = ring2[s];
            const v4 = ring2[nextS];

            // Triangle 1 (v1, v3, v2)
            this.pushVertex(v1);
            this.pushVertex(v3);
            this.pushVertex(v2);

            // Triangle 2 (v2, v3, v4)
            this.pushVertex(v2);
            this.pushVertex(v3);
            this.pushVertex(v4);
        }
    }

    pushVertex(v) {
        if (this.drawCount + 1 >= this.maxPoints) return;

        const i = this.drawCount * 3;
        this.positions[i] = v.pos.x;
        this.positions[i + 1] = v.pos.y;
        this.positions[i + 2] = v.pos.z;

        this.normals[i] = v.norm.x;
        this.normals[i + 1] = v.norm.y;
        this.normals[i + 2] = v.norm.z;

        this.drawCount++;
    }
}

export { VariableTubePainter };
