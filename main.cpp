#include <iostream>
#include <cmath>
#include <chrono>
#include <thread>

constexpr double SPEED_OF_LIGHT = 3.0e8; // m/s
constexpr double RADAR_FREQUENCY = 10.0e9; // 10 GHz
constexpr double TIME_STEP = 1.0; // seconds

class Signal {
public:
    double frequency;
    double velocity;
    Signal(double freq, double vel) : frequency(freq), velocity(vel) {}
};

class Target {
public:
    double position;
    double velocity;
    Target(double pos, double vel) : position(pos), velocity(vel) {}
    
    Signal reflect(const Signal& incoming) {
        double doppler_shift = (2 * velocity * incoming.frequency) / SPEED_OF_LIGHT;
        return Signal(incoming.frequency + doppler_shift, -incoming.velocity);
    }
};

class Radar {
public:
    void transmitAndReceive(Target& target) {
        Signal emitted(RADAR_FREQUENCY, SPEED_OF_LIGHT);
        std::cout << "Radar emitted signal at frequency: " << emitted.frequency << " Hz" << std::endl;
        
        Signal reflected = target.reflect(emitted);
        std::cout << "Received reflected signal at frequency: " << reflected.frequency << " Hz" << std::endl;
    }
};

int main() {
    Radar radar;
    Target target(1000.0, 30.0); // Target at 1000m moving at 30m/s
    
    for (int i = 0; i < 10; ++i) { // Simulate 10 pulses
        radar.transmitAndReceive(target);
        std::this_thread::sleep_for(std::chrono::seconds(1)); // Emit signal every second
    }
    
    return 0;
}
