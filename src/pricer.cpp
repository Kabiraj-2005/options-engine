#include<cmath>
#include<iostream>
#include<random>
#include<chrono>
#include<thread>
#include<vector>
#include<string>
#include<iomanip>
#include<algorithm>
#include<limits>
#include<stdexcept>

double norm_cdf(double x){
return 0.5*std::erfc(-x/std::sqrt(2));
}


double black_scholles_call(double S , double K , double T , double r , double v){
double d1 = (std::log(S/K) + (r+0.5*v*v)*T) / (v* std::sqrt(T));
double d2 = d1 - v * std::sqrt(T);

return S* norm_cdf (d1) - K*std::exp(-r*T)*norm_cdf(d2);
}

double  simulate_chunk(double S , double K ,double T, double r , double v , long long n_paths , unsigned seed ){
std::mt19937 rng(seed);
std::normal_distribution<double> norm(0.0 , 1.0);
double total = 0.0;

for(long long  i = 0 ; i < n_paths ; i++){
double z = norm(rng);
double ST = S*std::exp((r-0.5*v*v)*T+v*std::sqrt(T)*z);
total += std::max(ST-K , 0.0);
}

return total ;


}
double monte_carlo_call(double S , double K , double T , double r, double v , long long  n , unsigned seed){

    double total = simulate_chunk(S,K,T,r,v,n,seed) ;

return std::exp(-r*T)*(total/n);
}

double monte_carlo_call_mt(double S , double K , double T , double r , double v , long long n , int n_threads , unsigned base_seed){

    std::vector<std::thread> threads ;
    std::vector<double> sums(n_threads) ; 

    long long base = n / n_threads ; 
    long long  rem = n % n_threads ; 

    for(int t = 0 ; t < n_threads ; t++){
       long long my_paths = base ; 
        // this thread's path count plus leftover if t is the last thread. 
          
        if(t == n_threads-1){
            my_paths = my_paths + rem ; 
        }

        unsigned seed = base_seed + t ;

  threads.emplace_back([&, t, my_paths, seed]() { 


        sums[t] = simulate_chunk(S, K, T, r, v, my_paths, seed); 


         }

          );




    }

    for(auto& th : threads){
        th.join();
    }

    double total = 0.0 ; 
    for(int t = 0 ; t < n_threads ; t++){
        total = total + sums[t];

    }

    return std::exp(-r*T)*(total/n);




 




}




// Turns text into a whole number. Only plain digits are accepted, so "-1",
// "abc", "8abc" and "" are rejected. Fails if the number is above max.
bool parse_whole(const std::string& arg, unsigned long long max, unsigned long long& out){
if(arg.empty()) return false;
for(char c : arg){
    if(c < '0' || c > '9') return false;
}
try{
    out = std::stoull(arg);
}catch(const std::exception&){
    return false;      // too big even for unsigned long long
}
return out <= max;
}

void print_usage(const char* prog){
std::cerr << "usage: " << prog << " <threads> [--bench] [--seed N] [--paths N]\n"
          << "  <threads>   number of threads, whole number >= 1\n"
          << "  --bench     run only the multithreaded pricer and print one line:\n"
          << "              threads=N price=P time_ms=T\n"
          << "  --seed N    base seed, whole number >= 0 (default 42); thread t uses N + t\n"
          << "  --paths N   number of paths, whole number >= 1 (default 10000000)" << std::endl;
}

int main(int argc, char* argv[])
{
unsigned long long value = 0;
if(argc < 2 || !parse_whole(argv[1], std::numeric_limits<int>::max(), value) || value < 1){
    print_usage(argv[0]);
    return 1;
}
int n_threads = (int)value;
bool bench = false;
unsigned seed = 42;
long long n = 10000000;

for(int i = 2 ; i < argc ; i++){
    std::string opt = argv[i];
    if(opt == "--bench"){
        bench = true;
    }else if(opt == "--seed" && i + 1 < argc
             && parse_whole(argv[i+1], std::numeric_limits<unsigned>::max(), value)){
        seed = (unsigned)value;
        i++;
    }else if(opt == "--paths" && i + 1 < argc
             && parse_whole(argv[i+1], std::numeric_limits<long long>::max(), value) && value >= 1){
        n = (long long)value;
        i++;
    }else{
        print_usage(argv[0]);      // unknown option, or a missing/invalid value
        return 1;
    }
}

double S = 1400, K = 1500 , T = 0.25 , r = 0.06 , v = 0.30 ;

try{
    if(bench){
        auto start = std::chrono::steady_clock::now();
        double price = monte_carlo_call_mt(S,K,T,r,v,n,n_threads,seed);
        auto end = std::chrono::steady_clock::now();
        std::chrono::duration<double, std::milli> elapsed = end - start ;

        std::cout << std::fixed
                  << "threads=" << n_threads
                  << " price=" << std::setprecision(4) << price
                  << " time_ms=" << std::setprecision(3) << elapsed.count() << std::endl;
        return 0;
    }

    double bs_price = black_scholles_call(S,K,T,r,v);

    auto start_st = std::chrono::steady_clock::now();
    double st_price = monte_carlo_call(S,K,T,r,v,n,seed);
    auto end_st = std::chrono::steady_clock::now();

    auto start_mt = std::chrono::steady_clock::now();
    double mt_price = monte_carlo_call_mt(S,K,T,r,v,n,n_threads,seed);
    auto end_mt = std::chrono::steady_clock::now();

    std::chrono::duration<double, std::milli> elapsed_st = end_st - start_st ;
    std::chrono::duration<double, std::milli> elapsed_mt = end_mt - start_mt ;

    std::cout << std::fixed
              << "Paths: " << n << "   Base seed: " << seed << "\n"
              << "Black-Scholes price (exact):      " << std::setprecision(4) << bs_price << "\n"
              << "Monte Carlo, single-threaded:     " << st_price
              << "   time " << std::setprecision(3) << elapsed_st.count() << " ms\n"
              << "Monte Carlo, multithreaded:       " << std::setprecision(4) << mt_price
              << "   time " << std::setprecision(3) << elapsed_mt.count() << " ms"
              << "   (" << n_threads << " threads)\n"
              << "Speedup (this single run, not the official benchmark): "
              << std::setprecision(2) << elapsed_st.count() / elapsed_mt.count() << "x" << std::endl;
}catch(const std::exception& e){
    std::cerr << "error: " << e.what() << std::endl;   // e.g. the system could not start that many threads
    return 1;
}
return 0;
}
