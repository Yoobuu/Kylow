import React, { useEffect, useRef } from 'react';

export default function BackgroundAnimation() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width, height, points, target, animationFrameId;
    let animateHeader = true;

    // Configuración
    const COLOR_R = 225; // Rojo USFQ
    const COLOR_G = 27;
    const COLOR_B = 34;
    const POINT_DENSITY = 15; // Menos densidad para mejor performance

    function Point(x, y) {
      this.x = x;
      this.y = y;
      this.originX = x;
      this.originY = y;
      this.vx = (Math.random() - 0.5) * 0.5;
      this.vy = (Math.random() - 0.5) * 0.5;
      this.radius = 1.2 + Math.random() * 1.5;
      this.closest = [];
      this.active = 0;
    }

    Point.prototype.update = function() {
      this.x += this.vx;
      this.y += this.vy;
      if (Math.abs(this.x - this.originX) > 40) this.vx *= -1;
      if (Math.abs(this.y - this.originY) > 40) this.vy *= -1;
    };

    Point.prototype.draw = function() {
      if (!this.active) return;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI, false);
      ctx.fillStyle = `rgba(${COLOR_R},${COLOR_G},${COLOR_B},${this.active * 1.5})`;
      ctx.fill();
    };

    function getDistance(p1, p2) {
      return Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2);
    }

    function initPoints() {
      points = [];
      const stepX = Math.max(width / POINT_DENSITY, 60);
      const stepY = Math.max(height / POINT_DENSITY, 60);

      for (let x = 0; x < width; x += stepX) {
        for (let y = 0; y < height; y += stepY) {
          const px = x + Math.random() * stepX;
          const py = y + Math.random() * stepY;
          points.push(new Point(px, py));
        }
      }

      // Pre-cálculo de cercanos (simplificado)
      for (let i = 0; i < points.length; i++) {
        const closest = [];
        const p1 = points[i];
        for (let j = 0; j < points.length; j++) {
          const p2 = points[j];
          if (p1 === p2) continue;
          if (closest.length < 5) {
            closest.push(p2);
          } else {
            for (let k = 0; k < 5; k++) {
              if (getDistance(p1, p2) < getDistance(p1, closest[k])) {
                closest[k] = p2;
                break;
              }
            }
          }
        }
        p1.closest = closest;
      }
    }

    function animate() {
      if (animateHeader) {
        ctx.clearRect(0, 0, width, height);
        for (const p of points) {
          const dist = getDistance(target, p);
          if (dist < 5000) p.active = 0.3;
          else if (dist < 25000) p.active = 0.1;
          else if (dist < 45000) p.active = 0.02;
          else p.active = 0;

          p.update();
          p.draw();

          if (p.active > 0) {
            for (const close of p.closest) {
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(close.x, close.y);
              ctx.strokeStyle = `rgba(${COLOR_R},${COLOR_G},${COLOR_B},${p.active * 0.8})`;
              ctx.lineWidth = 0.5;
              ctx.stroke();
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    }

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      target = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    const handleResize = () => {
      if (canvas.parentElement) {
        width = canvas.parentElement.clientWidth || window.innerWidth;
        height = canvas.parentElement.clientHeight || window.innerHeight;
      } else {
        width = window.innerWidth;
        height = window.innerHeight;
      }
      canvas.width = width;
      canvas.height = height;
      target = { x: width / 2, y: height / 2 };
      initPoints();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);
    
    handleResize();
    animate();

    return () => {
      animateHeader = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden bg-transparent">
      <canvas ref={canvasRef} className="block h-full w-full opacity-40" />
    </div>
  );
}
