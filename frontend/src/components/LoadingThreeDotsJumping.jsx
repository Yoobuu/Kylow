import { motion as Motion } from 'framer-motion';

// —————— Componente de carga: tres puntos que saltan en secuencia ——————
export default function LoadingThreeDotsJumping() {
  return (
    // Contenedor flex centrado y con espacio uniforme entre puntos
    <div className="flex justify-center items-center gap-2">
      { [0, 1, 2].map(i => (
        // Cada punto es un círculo animado con salto vertical
        <Motion.div
          key={i}
          className="w-[16px] h-[16px] rounded-full bg-[#5da345]"
          // Definición de la animación: subir 15px y volver
          animate={{ y: [0, -15, 0] }}
          transition={{
            duration: 0.6,     // Tiempo de cada salto
            repeat: Infinity,  // Repetición indefinida
            ease: 'easeInOut', // Easing para suavizar el movimiento
            delay: i * 0.1     // Desfase progresivo entre puntos
          }}
        />
      )) }
    </div>
  );
}
