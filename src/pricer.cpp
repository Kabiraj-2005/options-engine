#include<cmath>
#include<iostream>
#include<random>
#include<chrono>
#include<thread>
#include<vector>

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
double monte_carlo_call(double S , double K , double T , double r, double v , long long  n){

    double total = simulate_chunk(S,K,T,r,v,n,42) ; 

return std::exp(-r*T)*(total/n);
}

double monte_carlo_call_mt(double S , double K , double T , double r , double v , long long n , int n_threads){

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

        unsigned seed = 42 + t ;

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




int main()
{
double S = 1400, K = 1500 , T = 0.25 , r = 0.06 , v = 0.30 ;
double bs_price = black_scholles_call(S,K,T,r,v);
auto start = std::chrono::high_resolution_clock::now();
double cs_price = monte_carlo_call(S,K,T,r,v,10000000);
auto end = std::chrono::high_resolution_clock::now();
auto start_st = std::chrono::high_resolution_clock::now();
double mcs_price = monte_carlo_call_mt(S,K,T,r,v,10000000, 4);
auto end_st = std::chrono::high_resolution_clock::now();
std::chrono::duration<double, std::milli> elapsed = end - start ;
std::chrono::duration<double, std::milli> elapsed_st = end_st - start_st ;
std::cout << "Black-Scholles price: " << bs_price << std::endl;
std::cout << "Monte Carlo Price: " << cs_price << std::endl;
std::cout << "Monte Carlo Price with multithreading: " << mcs_price << std::endl;

std::cout << "Time Taken normally : " << elapsed.count() << "ms" << std::endl;


std::cout << "Time Taken using multithreading : " << elapsed_st.count() << "ms" << std::endl;

return 0;
}


