

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { Pose } from '../types';

interface ThreeSceneProps {
  pose: Pose;
}

export const ThreeScene: React.FC<ThreeSceneProps> = ({ pose }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  // FIX: Provide an initial value to useRef to resolve "Expected 1 arguments, but got 0" error.
  const modelRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1f2937); // bg-gray-800

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000);
    camera.position.set(2, 2, 4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    //mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    // Coordinate System Helpers
    const axesHelper = new THREE.AxesHelper(1.5);
    scene.add(axesHelper);

    const gridHelper = new THREE.GridHelper(10, 10);
    gridHelper.material.opacity = 0.25;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // 3D Model representing the IMU
    const modelGroup = new THREE.Group();
    const bodyGeometry = new THREE.BoxGeometry(1, 0.2, 0.5);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x0891b2 }); // cyan-600
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);

    // Add a marker for the "front" of the device
    const frontGeometry = new THREE.ConeGeometry(0.1, 0.3, 16);
    const frontMaterial = new THREE.MeshStandardMaterial({ color: 0xfacc15 }); // yellow-400
    const frontMarker = new THREE.Mesh(frontGeometry, frontMaterial);
    frontMarker.position.set(0.5, 0.1, 0); // Positioned at the +X end
    frontMarker.rotation.z = -Math.PI / 2;

    modelGroup.add(body);
    modelGroup.add(frontMarker);
    scene.add(modelGroup);
    modelRef.current = modelGroup;

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if(mountRef.current) {
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
        window.removeEventListener('resize', handleResize);
        mountRef.current?.removeChild(renderer.domElement);
        renderer.dispose();
        //scene.dispose();
        //modelGroup.dispose();
        console.log("Cleaned up Three.js scene");
    };
  }, []);


    if (modelRef.current) {
        // Apply position
        modelRef.current.position.set(pose.position.x, pose.position.y, pose.position.z);

        // Apply orientation
        const { x, y, z, w } = pose.orientation;
        modelRef.current.quaternion.set(x, y, z, w);
    }


  return <div ref={mountRef} id="three-scene" className="w-full h-full absolute top-0 left-0" />;
};